import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  appType: 'spa',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    css: false,
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 3000,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:   ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          ui:       ['lucide-react'],
        },
      },
    },
  },
  plugins: [tsconfigPaths(), react()],
  server: {
    port: Number(process.env.PORT) || 4028,
    host: "0.0.0.0",
    strictPort: true,
    historyApiFallback: true,
    allowedHosts: ['.amazonaws.com', '.builtwithrocket.new']
  }
});