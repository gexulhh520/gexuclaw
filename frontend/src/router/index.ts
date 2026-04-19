import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useUserStore } from '../stores/user'
import Chat from '../views/Chat.vue'
import Login from '../views/Login.vue'
import ScheduledTasks from '../views/ScheduledTasks.vue'
import UserSettings from '../views/UserSettings.vue'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/chat'
  },
  {
    path: '/login',
    name: 'Login',
    component: Login,
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
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫
router.beforeEach(async (to, from, next) => {
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
    next('/chat')
    return
  }
  
  next()
})

export default router
