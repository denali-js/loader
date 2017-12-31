import * as path from 'path';

export default function withoutExtension(filepath: string): string {
  return path.join(path.dirname(filepath), path.basename(filepath, path.extname(filepath)));
}