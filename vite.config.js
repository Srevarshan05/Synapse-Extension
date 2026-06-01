import { defineConfig } from 'vite';
import react             from '@vitejs/plugin-react';
import { resolve }       from 'path';

export default defineConfig(({ mode }) => {
  // If we're building the content script
  if (process.env.BUILD_TARGET === 'content') {
    return {
      build: {
        outDir: resolve(__dirname, 'extension'),
        emptyOutDir: false, // Don't wipe the extension directory
        lib: {
          entry: resolve(__dirname, 'src/content/index.js'),
          name: 'SynapseContent',
          formats: ['iife'],
          fileName: () => 'content.bundle.js'
        },
        rollupOptions: {
          output: {
            extend: true,
          }
        }
      }
    };
  }

  // Default: Dashboard build
  return {
    plugins: [react()],
    root: resolve(__dirname, 'src/dashboard'),
    publicDir: resolve(__dirname, 'public'),
    build: {
      outDir: resolve(__dirname, 'extension/dashboard'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/dashboard/index.html')
      }
    },
    base: './'
  };
});
