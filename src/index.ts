import * as path from 'path';
import { sync as resolve } from 'resolve';

export default class Loader {

  cwd: string;
  parent: Loader;
  pkgName: string;
  children = new Map<string, Loader>();

  factories = new Map<string, ModuleFactory>();
  cache = new Map<string, any>();
  main: string;

  constructor(parent?: Loader, pkgName?: string) {
    if (parent) {
      this.parent = parent;
      this.pkgName = pkgName;
      this.cwd = path.join(parent.cwd, 'node_modules', pkgName);
    } else {
      this.cwd = process.cwd();
    }
  }

  scope(pkgName: string, version: string): Loader {
    let loader = new Loader(this, pkgName);
    this.children.set(pkgName, loader);
    return loader;
  }

  add(modulepath: string, factory: ModuleFactory, options: { main?: boolean } = {}): void {
    this.factories.set(modulepath, factory);
    if (options.main) {
      this.main = modulepath;
    }
  }

  loadFrom(from: string, loadpath: string): any {
    if (isRelative(loadpath)) {
      // require('./foo/bar');
      return this.loadRelative(from, loadpath);
    } else {
      // require('some-pkg');
      return this.loadPackage(loadpath);
    }
  }

  load(loadpath: string) {
    return this.loadRelative('/', path.join('.', loadpath));
  }

  loadMain() {
    return this.load(this.main);
  }

  loadRelative(from: string, loadpath: string): any {
    let modulepath = path.join(from, path.basename(loadpath, path.extname(loadpath)));
    let variants = [ modulepath, `${ modulepath }/index` ];
    for (let variant of variants) {
      if (this.factories.has(variant)) {
        if (!this.cache.has(variant)) {
          this.loadModule(from, variant);
        }
        return this.cache.get(variant);
      }
    }
    this.fallback(from, loadpath);
  }

  loadModule(from: string, modulepath: string): void {
    let factory = this.factories.get(modulepath);
    let dirname = path.dirname(modulepath);
    let require = this.loadFrom.bind(this, dirname);
    let absoluteFilepath = path.join(this.cwd, modulepath.slice(1));
    let absoluteDirpath = path.join(this.cwd, dirname.slice(1));
    let exports = {};
    let module = {
      id: absoluteFilepath,
      filename: absoluteFilepath,
      loaded: false,
      parent: this.cache.get(from),
      children: <NodeModule[]>[],
      require,
      exports
    };
    this.cache.set(modulepath, module);
    factory(module, exports, require, absoluteFilepath, absoluteDirpath);
    module.loaded = true;
    module.parent.children.push(module);
  }

  loadPackage(loadpath: string): any {
    let [ pkgName, ...childpathParts ] = loadpath.split('/');
    // Handle scoped packages
    if (pkgName.startsWith('@')) {
      pkgName = [ pkgName, childpathParts.shift() ].join('/');
    }
    if (this.children.has(pkgName)) {
      let pkgLoader = this.children.get(pkgName);
      let childpath = childpathParts.join('/');
      // require('some-pkg')
      if (childpath.length === 0) {
        return pkgLoader.loadMain();
      }
      // require('some-pkg/foo/bar')
      return pkgLoader.loadRelative('/', childpath);
    }
    return this.fallback(null, loadpath);
  }

  fallback(from: string, loadpath: string) {
    if (this.parent) {
      return this.parent.loadFrom(from, loadpath);
    }
    return require(resolve(loadpath, { basedir: path.dirname(from.slice(1)) }));
  }

}

export interface ModuleFactory {
  (module: NodeModule, exports: {}, require: NodeRequire, filename: string, dirname: string): void;
}

function isRelative(p: string) {
  return p.startsWith('.');
}
