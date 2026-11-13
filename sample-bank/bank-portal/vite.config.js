import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const thunderidUrl = process.env.THUNDERID_URL ?? 'https://localhost:8090';
const bankApiUrl = process.env.BANK_API_URL ?? 'http://localhost:4000';

// The browser talks only to this dev server. ThunderID's flow endpoint, the bank API and the agent
// toolkit downloads are proxied. The ThunderID Vue SDK calls ThunderID directly, so the `cors` server config allows this origin.
const toThunderID = { target: thunderidUrl, changeOrigin: true, secure: false };

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/flow/execute': toThunderID,
      // The owner's self-service calls and the dashboard's management calls: /thunderid/users/me/agents
      // reaches ThunderID's /users/me/agents.
      '/thunderid': { ...toThunderID, rewrite: (path) => path.replace(/^\/thunderid/, '') },
      '/api': { target: bankApiUrl, changeOrigin: true },
      '/agent': { target: bankApiUrl, changeOrigin: true },
    },
  },
});
