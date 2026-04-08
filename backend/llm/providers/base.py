import base64
from pathlib import Path
from typing import Optional, List, Dict, Any, AsyncGenerator, Protocol, Union


class BaseProvider(Protocol):
    """LLM Provider Protocol"""
    
    async def chat(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Unified chat interface
        
        Args:
            messages: Unified multimodal message list
                     [{"role": "...",
                       "content": [{"type": "text|image|audio",
                                   "content": "...",
                                   "id": "optional"}],
                       ...}]
            temperature: Temperature parameter
            max_tokens: Max token count
            tools: Tool definition list
            system_prompt: System prompt (appended internally, not in messages)
            
        Returns:
            {
                "content": str,
                "role": str,
                "tool_calls": [...] | None,
                "reasoning_content": str | None,
            }
        """
        ...

    async def stream(
        self,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Unified streaming interface
        
        Yields:
            {"content": str, "tool_calls": [...], "finish_reason": str}
        """
        ...

    async def embedding(self, text: str) -> List[float]:
        ...

    async def embedding_batch(self, texts: List[str]) -> List[List[float]]:
        ...


class BaseProviderImpl:
    """Provider base implementation - provides message format conversion utilities"""
    
    def _read_file_content(self, file_path: str) -> Optional[bytes]:
        """
        Read file content from path
        
        Supports:
        - Relative path: /images/2024/04/abc123.png
        - Absolute path: D:/gexuclaw_uploads/images/2024/04/abc123.png
        - URL: http://... (returns None, should be handled separately)
        - Base64: already encoded (returns None)
        """
        if not file_path:
            return None
        
        if not isinstance(file_path, str):
            return None
        
        # URL or data URL - not a file path
        if file_path.startswith(("http://", "https://", "data:")):
            return None
        
        # Check if already base64
        try:
            base64.b64decode(file_path)
            return None  # Already base64, no need to read
        except:
            pass
        
        # Build full path
        from core.config import get_settings
        settings = get_settings()
        
        # Remove leading slash if present
        relative_path = file_path.lstrip("/")
        full_path = Path(settings.UPLOAD_DIR) / relative_path
        
        if not full_path.exists():
            print(f"[Provider] File not found: {full_path}")
            return None
        
        with open(full_path, "rb") as f:
            return f.read()
    
    def _content_to_base64(self, content: str, default_mime: str = "image/png") -> Optional[str]:
        """
        Convert content to base64 string
        
        Handles:
        - File path -> read and encode
        - URL -> return as is
        - Base64 -> return as is
        - Bytes -> encode
        """
        if not content:
            return None
        
        # URL or data URL - return as is
        if isinstance(content, str) and content.startswith(("http://", "https://", "data:")):
            return content
        
        # Bytes - encode directly
        if isinstance(content, bytes):
            return base64.b64encode(content).decode()
        
        # Try to read as file path
        file_content = self._read_file_content(content)
        if file_content:
            return base64.b64encode(file_content).decode()
        
        # Check if already base64
        if isinstance(content, str):
            try:
                base64.b64decode(content)
                return content
            except:
                pass
        
        return None
    
    def _get_mime_type(self, file_path: str) -> str:
        """Get MIME type from file extension"""
        ext = file_path.lower().split(".")[-1] if "." in file_path else ""
        
        mime_map = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "gif": "image/gif",
            "webp": "image/webp",
            "wav": "audio/wav",
            "mp3": "audio/mpeg",
            "m4a": "audio/mp4",
            "ogg": "audio/ogg",
            "webm": "audio/webm",
        }
        
        return mime_map.get(ext, "application/octet-stream")
    
    def _normalize_message(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize a single message
        
        Handles:
        1. String content -> list format
        2. Field name standardization
        """
        content = msg.get("content")
        
        if isinstance(content, str):
            content = [{"type": "text", "content": content}]
        
        normalized_msg = {
            "role": msg.get("role"),
            "content": content,
        }
        
        if msg.get("tool_calls"):
            normalized_msg["tool_calls"] = msg["tool_calls"]
        if msg.get("tool_call_id"):
            normalized_msg["tool_call_id"] = msg["tool_call_id"]
        if msg.get("reasoning_content"):
            normalized_msg["reasoning_content"] = msg["reasoning_content"]
            
        return normalized_msg
    
    def _normalize_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize all messages"""
        return [self._normalize_message(msg) for msg in messages]
    
    def _convert_to_provider_format(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Convert to specific provider format (override in subclass)
        
        Default implementation: extract plain text (for non-multimodal providers)
        """
        converted = []
        for msg in self._normalize_messages(messages):
            new_msg = {"role": msg["role"]}
            
            content_list = msg.get("content", [])
            text_parts = []
            for item in content_list:
                if item.get("type") == "text":
                    text_parts.append(item.get("content", ""))
            
            new_msg["content"] = "\n".join(text_parts) if text_parts else ""
            
            if msg.get("tool_calls"):
                new_msg["tool_calls"] = msg["tool_calls"]
            if msg.get("tool_call_id"):
                new_msg["tool_call_id"] = msg["tool_call_id"]
                
            converted.append(new_msg)
        
        return converted
    
    def _add_system_prompt(self, messages: List[Dict[str, Any]], system_prompt: str) -> List[Dict[str, Any]]:
        """Add system prompt to the beginning of messages"""
        if not system_prompt:
            return messages
            
        system_msg = {
            "role": "system",
            "content": [{"type": "text", "content": system_prompt}]
        }
        return [system_msg] + messages
    
    def _extract_text_from_messages(self, messages: List[Dict[str, Any]]) -> str:
        """Extract plain text from multimodal messages (for embedding, etc.)"""
        texts = []
        for msg in messages:
            content_list = msg.get("content", [])
            if isinstance(content_list, str):
                texts.append(content_list)
            elif isinstance(content_list, list):
                for item in content_list:
                    if isinstance(item, dict) and item.get("type") == "text":
                        texts.append(item.get("content", ""))
                    elif isinstance(item, str):
                        texts.append(item)
        return "\n".join(texts)
