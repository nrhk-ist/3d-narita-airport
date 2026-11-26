import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名のパスで公開される
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/3d-narita-airport/' : '/',
});
