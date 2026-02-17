/**
 * Generate extension icons from ggwallet.png.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const src = readFileSync("src/assets/ggwallet.png");
const dir = "src/assets/icons";
mkdirSync(dir, { recursive: true });

for (const size of [16, 48, 128]) {
  writeFileSync(`${dir}/icon${size}.png`, src);
  console.log(`Created icon${size}.png from ggwallet.png (${src.length} bytes)`);
}
