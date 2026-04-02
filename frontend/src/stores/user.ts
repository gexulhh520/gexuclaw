import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

const API_BASE_URL = '/api'

interface User {
  id: number
  username: string
  email: string
  is_active: boolean
  created_at: string
}

interface TokenData {
  access_token: string
  token_type: string
  user: User
}

export const useUserStore = defineStore('user', () => {
  // State
  const token = ref<string>(localStorage.getItem('token') || '')
  const user = ref<User | null>(null)
  const isLoading = ref(false)
  const error = ref<string>('')
  const isInitialized = ref(false)  // 标记是否已初始化

  // Getters
  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const authHeader = computed(() => token.value ? { Authorization: `Bearer ${token.value}` } : {})

  // Actions
  async function register(username: string, email: string, password: string) {
    isLoading.value = true
    error.value = ''
    
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/register`, {
        username,
        email,
        password
      })
      
      return { success: true, data: response.data }
    } catch (err: any) {
      error.value = err.response?.data?.detail || '注册失败'
      return { success: false, error: error.value }
    } finally {
      isLoading.value = false
    }
  }

  async function login(username: string, password: string) {
    isLoading.value = true
    error.value = ''
    
    try {
      const response = await axios.post<TokenData>(`${API_BASE_URL}/auth/login`, {
        username,
        password
      })
      
      token.value = response.data.access_token
      user.value = response.data.user
      
      // 保存到 localStorage
      localStorage.setItem('token', token.value)
      
      // 设置 axios 默认 header
      axios.defaults.headers.common['Authorization'] = `Bearer ${token.value}`
      
      return { success: true }
    } catch (err: any) {
      error.value = err.response?.data?.detail || '登录失败'
      return { success: false, error: error.value }
    } finally {
      isLoading.value = false
    }
  }

  async function fetchCurrentUser() {
    if (!token.value || isInitialized.value) return
    
    isLoading.value = true
    try {
      const response = await axios.get(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token.value}` }
      })
      user.value = response.data
      isInitialized.value = true
      
      // 设置 axios 默认 header
      axios.defaults.headers.common['Authorization'] = `Bearer ${token.value}`
    } catch (err) {
      // Token 无效，清除登录状态
      logout()
    } finally {
      isLoading.value = false
    }
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
    delete axios.defaults.headers.common['Authorization']
  }

  return {
    token,
    user,
    isLoading,
    error,
    isLoggedIn,
    isInitialized,
    authHeader,
    register,
    login,
    logout,
    fetchCurrentUser
  }
})
