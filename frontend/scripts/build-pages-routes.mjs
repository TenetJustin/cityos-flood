import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZHEJIANG_CITIES } from '../src/zhejiangData.js'

if (process.env.VITE_STATIC_PAGES !== 'true' || process.env.VITE_BASE_PATH !== '/cityos-flood/') {
  throw new Error('GitHub Pages route generation requires the static Pages build environment')
}

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const html = await readFile(join(dist, 'index.html'), 'utf8')
const sections = ['points', 'impact', 'decision', 'events', 'scenario', 'data']
const routes = [
  'workbench',
  ...ZHEJIANG_CITIES.flatMap(({ id }) => [`workbench/${id}`, ...sections.map((section) => `workbench/${id}/${section}`)]),
  'about', 'about/product', 'welcome', 'overview', 'cities',
]

for (const route of routes) {
  const directory = join(dist, route)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.html'), html)
}
await copyFile(join(dist, 'index.html'), join(dist, '404.html'))
console.log(`Materialized ${routes.length} known routes and a fallback page.`)
