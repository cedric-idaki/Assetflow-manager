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
          // Deliberately NOT naming recharts/stripe here. With the route
          // components code-split in Routes.jsx, rollup already emits them as
          // shared chunks fetched only by the pages that chart or take card
          // payments. Naming them in manualChunks pins them into the entry
          // graph instead, which put 532 KB of recharts back in the startup
          // preload for every user including those who never open a chart.
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