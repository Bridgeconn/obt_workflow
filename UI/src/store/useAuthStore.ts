import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  user_id: string;
  username: string;
  email: string;
  role: 'Admin' | 'AI' | 'User';
  created_date: string;
  last_login: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  clearError: () => void;
  signup: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateRole: (userId: string, role: 'Admin' | 'AI' | 'User') => Promise<void>;
  checkAuthStatus: () => Promise<boolean>;
  fetchUserDetails: () => Promise<void>;
}

const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      error: null,

      login: async (username, password) => {
        try {
          const payload = new URLSearchParams();
          payload.append('username', username);
          payload.append('password', password);

          const response = await fetch(`http://localhost:8000/token`, {
            body: payload,
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });

          if (!response.ok) {
            throw new Error('Login failed. Please check your credentials.');
          }

          const data = await response.json();
          const token = data.access_token;

          set({ token });
          await get().fetchUserDetails();
        } catch (error) {
          set({ error: 'Login failed. Please try again.' });
          throw error;
        }
      },

      clearError: () => set({ error: null }),

      signup: async (username, email, password) => {
        try {
          const response = await fetch(
            `http://localhost:8000/user/signup?username=${username}&email=${email}&password=${password}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.detail || 'Signup failed. Please try again.');
          }
          console.log('User registered:', data);
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Signup failed. Please try again.' });
          throw error;
        }
      },

      logout: async () => {
        try {
          const token = get().token;
          if (!token) {
            throw new Error('User is not authenticated');
          }

          const response = await fetch('http://localhost:8000/user/logout/', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            throw new Error('Logout failed');
          }

          set({ user: null, token: null });
        } catch (error) {
          set({ error: 'Failed to log out' });
          throw error;
        }
      },

      updateRole: async (userId, role) => {
        const token = get().token;
        if (!token) {
          throw new Error('Not authenticated');
        }

        const response = await fetch(
          `http://localhost:8000/user/?user_id=${userId}&role=${role}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || 'Failed to update role');
        }
        console.log('Role updated successfully', data);
      },

      checkAuthStatus: async () => {
        const token = get().token;

        if (token) {
          try {
            await get().fetchUserDetails();
            return true;
          } catch (error) {
            console.error('Error checking authentication status:', error);
            set({ user: null, token: null });
            return false;
          }
        }

        return false;
      },

      fetchUserDetails: async () => {
        const token = get().token;
        if (!token) {
          throw new Error('User not authenticated');
        }

        const response = await fetch('http://localhost:8000/user/', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        const userResp = await response.json();
        console.log("user response", userResp)
        if (!response.ok) {
          throw new Error(userResp.detail || 'Failed to fetch user details');
        }

        set({ user: userResp });
      },
    }),
    {
      name: 'authToken',
      partialize: (state) => ({ token: state.token }),
    }
  )
)

export default useAuthStore;

