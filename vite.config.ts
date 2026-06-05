import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const useRemoteCloudflareData = process.env.CLOUDFLARE_REMOTE_DATA === '1'

const config = defineConfig({
  plugins: [
    cloudflare({
      configPath: useRemoteCloudflareData
        ? 'wrangler.remote-data.jsonc'
        : undefined,
      remoteBindings: useRemoteCloudflareData,
      viteEnvironment: { name: 'ssr' },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
