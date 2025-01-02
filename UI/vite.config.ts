import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        format: 'cjs', // Change to 'cjs' for CommonJS format
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "/",
})

