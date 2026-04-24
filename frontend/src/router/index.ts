import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useUserStore } from '../stores/user'
import Chat from '../views/Chat.vue'
import Login from '../views/Login.vue'
import ScheduledTasks from '../views/ScheduledTasks.vue'
import UserSettings from '../views/UserSettings.vue'
import AgentPlatform from '../views/AgentPlatform.vue'
import WorkbenchHome from '../views/WorkbenchHome.vue'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/workspace'
  },
  {
    path: '/workspace',
    name: 'WorkbenchHome',
    component: WorkbenchHome,
    meta: { requiresAuth: false }
  },
  {
    path: '/login',
    name: 'Login',
    component: Login,
    redirect: '/workspace',
    meta: { guest: true }
  },
  {
    path: '/chat',
    name: 'Chat',
    component: Chat,
    meta: { requiresAuth: true }
  },
  {
    path: '/tasks',
    name: 'ScheduledTasks',
    component: ScheduledTasks,
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'UserSettings',
    component: UserSettings,
    meta: { requiresAuth: true }
  },
  {
    path: '/agent-platform',
    name: 'AgentPlatform',
    component: AgentPlatform,
    meta: { requiresAuth: false }
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  const userStore = useUserStore()
  
  // 如果有 token 且未初始化，尝试获取用户信息
  if (userStore.token && !userStore.isInitialized) {
    await userStore.fetchCurrentUser()
  }
  
  // 需要登录的页面
  if (to.meta.requiresAuth && !userStore.isLoggedIn) {
    next('/login')
    return
  }
  
  // 游客页面（已登录用户不能访问）
  if (to.meta.guest && userStore.isLoggedIn) {
    next('/workspace')
    return
  }
  
  next()
})

export default router
