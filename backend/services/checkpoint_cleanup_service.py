from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


@dataclass(frozen=True)
class CheckpointCleanupConfig:
    database_url: str
    keep_per_thread: int = 50
    retention_days: int = 30
    schema: str = "public"


def _create_engine_for_checkpoint_db(database_url: str) -> Engine:
    # CHECKPOINT_DATABASE_URL is expected to be a psycopg-compatible URI like:
    # postgresql://user:pass@host:5432/db
    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_recycle=3600,
    )


def _fetchall(conn, sql: str, params: Optional[dict[str, Any]] = None) -> list[tuple]:
    return list(conn.execute(text(sql), params or {}).fetchall())


def _get_tables(conn, schema: str) -> list[str]:
    rows = _fetchall(
        conn,
        """
        select tablename
        from pg_tables
        where schemaname = :schema
        order by tablename
        """,
        {"schema": schema},
    )
    return [r[0] for r in rows]


def _get_columns(conn, schema: str, table: str) -> list[tuple[str, str]]:
    rows = _fetchall(
        conn,
        """
        select column_name, data_type
        from information_schema.columns
        where table_schema = :schema and table_name = :table
        order by ordinal_position
        """,
        {"schema": schema, "table": table},
    )
    return [(r[0], r[1]) for r in rows]


def _fk_dependency_edges(conn, schema: str, tables: Iterable[str]) -> list[tuple[str, str]]:
    """
    Returns edges parent->child for FKs within the provided table set.
    """
    table_set = set(tables)
    rows = _fetchall(
        conn,
        """
        select
            parent.relname as parent_table,
            child.relname  as child_table
        from pg_constraint con
        join pg_class child on child.oid = con.conrelid
        join pg_class parent on parent.oid = con.confrelid
        join pg_namespace nsp on nsp.oid = child.relnamespace
        where con.contype = 'f'
          and nsp.nspname = :schema
        """,
        {"schema": schema},
    )
    edges: list[tuple[str, str]] = []
    for parent, child in rows:
        if parent in table_set and child in table_set:
            edges.append((parent, child))
    return edges


def _topo_sort_tables_child_first(tables: list[str], edges_parent_child: list[tuple[str, str]]) -> list[str]:
    """
    Sort tables so that children are deleted before parents.
    If there are cycles or missing info, returns a stable fallback order.
    """
    table_set = set(tables)
    parents_to_children: dict[str, set[str]] = {t: set() for t in table_set}
    children_to_parents: dict[str, set[str]] = {t: set() for t in table_set}
    for parent, child in edges_parent_child:
        parents_to_children[parent].add(child)
        children_to_parents[child].add(parent)

    # Kahn: process leaves (no children) first => children-first deletion order.
    out_degree = {t: len(parents_to_children[t]) for t in table_set}
    queue = [t for t, deg in out_degree.items() if deg == 0]
    queue.sort()

    parent_last: list[str] = []
    while queue:
        n = queue.pop(0)
        parent_last.append(n)
        for parent in sorted(children_to_parents[n]):
            out_degree[parent] -= 1
            if out_degree[parent] == 0:
                queue.append(parent)
                queue.sort()

    if len(parent_last) != len(table_set):
        # Cycle or incomplete constraints. Use a deterministic fallback: longer names first (often "writes"/"blobs" come first),
        # with "checkpoints" last if present.
        fallback = sorted(tables, key=lambda t: (t == "checkpoints", -len(t), t))
        return fallback

    return parent_last


def _choose_checkpoint_base_table(conn, schema: str, tables: list[str]) -> Optional[str]:
    """
    Heuristic: pick the table that looks like the canonical checkpoints table.
    """
    candidates = []
    for t in tables:
        cols = {c for c, _ in _get_columns(conn, schema, t)}
        if "thread_id" in cols and "checkpoint_id" in cols:
            candidates.append(t)
    if not candidates:
        return None
    # Prefer a table name containing "checkpoint" and/or plural "checkpoints".
    candidates.sort(key=lambda t: (t != "checkpoints", "checkpoint" not in t, len(t), t))
    return candidates[0]


def _choose_order_column(conn, schema: str, table: str) -> Optional[str]:
    cols = _get_columns(conn, schema, table)
    col_map = {name: dtype for name, dtype in cols}
    # Prefer a timestamp-ish column if present.
    for name in ("created_at", "updated_at", "ts", "timestamp", "time"):
        if name in col_map:
            return name
    # Fallback to an integer-ish column.
    for name, dtype in cols:
        if dtype in ("integer", "bigint", "smallint"):
            return name
    return None


def cleanup_langgraph_checkpoints(cfg: CheckpointCleanupConfig) -> dict[str, Any]:
    """
    Cleans up LangGraph checkpoint tables in the checkpoint database:
    - Keep only the latest N checkpoints per thread_id (and optionally enforce a time-based retention when possible).

    This is designed to work across minor schema differences by introspecting the DB.
    """
    engine = _create_engine_for_checkpoint_db(cfg.database_url)
    deleted_by_table: dict[str, int] = {}

    with engine.begin() as conn:
        all_tables = _get_tables(conn, cfg.schema)
        suspect_tables = [
            t
            for t in all_tables
            if (("checkpoint" in t) or ("langgraph" in t) or t.startswith("lg_"))
            # Never delete migration bookkeeping tables.
            and (not t.endswith("_migrations"))
            and (t != "checkpoint_migrations")
        ]
        if not suspect_tables:
            return {"deleted_by_table": {}, "note": "no_suspect_tables_found"}

        base_table = _choose_checkpoint_base_table(conn, cfg.schema, suspect_tables)
        if not base_table:
            return {"deleted_by_table": {}, "note": "no_base_table_with_thread_id_and_checkpoint_id"}

        base_cols = {c for c, _ in _get_columns(conn, cfg.schema, base_table)}
        id_cols = ["thread_id", "checkpoint_id"]
        if "checkpoint_ns" in base_cols:
            id_cols.append("checkpoint_ns")

        order_col = _choose_order_column(conn, cfg.schema, base_table)
        if not order_col:
            # Can't rank reliably; do nothing rather than delete unpredictably.
            return {"deleted_by_table": {}, "note": f"no_order_column_in_{base_table}"}

        # Only delete from tables that share the key columns, so we don't touch unrelated tables.
        target_tables: list[str] = []
        table_cols: dict[str, set[str]] = {}
        for t in suspect_tables:
            cols = {c for c, _ in _get_columns(conn, cfg.schema, t)}
            table_cols[t] = cols
            if all(c in cols for c in id_cols):
                target_tables.append(t)

        edges = _fk_dependency_edges(conn, cfg.schema, target_tables)
        delete_order = _topo_sort_tables_child_first(target_tables, edges)

        # Build a to-delete CTE from the base table, then delete matching rows from each target table.
        # We always enforce keep_per_thread; we also try to enforce retention_days when order_col is timestamp-ish.
        base_fq = f'{cfg.schema}."{base_table}"'
        cutoff_expr = "now() - (:retention_days || ' days')::interval"

        # Determine if order_col can be compared to a timestamp cutoff.
        order_dtype = {n: d for n, d in _get_columns(conn, cfg.schema, base_table)}.get(order_col)
        can_time_filter = order_dtype in ("timestamp with time zone", "timestamp without time zone", "date")

        id_select = ", ".join([f'b."{c}"' for c in id_cols])
        id_join = " and ".join([f't."{c}" = d."{c}"' for c in id_cols])

        if can_time_filter:
            to_delete_cte = f"""
            with ranked as (
              select
                {id_select},
                b."{order_col}" as ord,
                row_number() over (partition by b."thread_id" order by b."{order_col}" desc) as rn
              from {base_fq} b
            ),
            to_delete as (
              select {", ".join([f'"{c}"' for c in id_cols])}
              from ranked
              where rn > :keep_per_thread
                 or ord < {cutoff_expr}
            )
            """
        else:
            to_delete_cte = f"""
            with ranked as (
              select
                {id_select},
                row_number() over (partition by b."thread_id" order by b."{order_col}" desc) as rn
              from {base_fq} b
            ),
            to_delete as (
              select {", ".join([f'"{c}"' for c in id_cols])}
              from ranked
              where rn > :keep_per_thread
            )
            """

        params = {"keep_per_thread": cfg.keep_per_thread, "retention_days": cfg.retention_days}

        for t in delete_order:
            fq = f'{cfg.schema}."{t}"'
            sql = f"""
            {to_delete_cte}
            delete from {fq} t
            using to_delete d
            where {id_join}
            """
            result = conn.execute(text(sql), params)
            deleted_by_table[t] = int(getattr(result, "rowcount", 0) or 0)

    return {
        "base_table": base_table,
        "order_col": order_col,
        "id_cols": id_cols,
        "deleted_by_table": deleted_by_table,
    }
