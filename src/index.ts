import * as path from 'path';
import { sync as resolve } from 'resolve';
import * as isBuiltinModule from 'is-builtin-module';
import isRelative from './is-relative';
import withoutExtension from './without-extension';

export interface ModuleFactory {
  (module: NodeModule, exports: {}, require: NodeRequire, filename: string, dirname: string): void;
}

export interface Fallback<T> {
  (root?: string, from?: string, loadpath?: string): T;
}

export default class Loader {

  cwd: string;
  parent: Loader;
  pkgName: string;
  version: string;
  children = new Map<string, Loader>();
  // We type this to `any` to avoid circular dependencies, but Denali uses this during bootup
  resolver: any;

  factories = new Map<string, ModuleFactory>();
  cache = new Map<string, any>();
  main: string;

  constructor(pkgName: string, version: string, parent?: Loader) {
    this.pkgName = pkgName;
    this.version = version;
    if (parent) {
      this.parent = parent;
      this.cwd = path.join(parent.cwd, 'node_modules', pkgName);
    } else {
      this.cwd = process.cwd();
    }
  }

  protected dir(): string {
    if (this.parent) {
      return path.join(this.parent.dir(), 'node_modules', this.pkgName);
    }
    return process.cwd();
  }

  scope(pkgName: string, version: string, fragmentFactory: (loader: Loader) => void) {
    let loader = new Loader(pkgName, version, this);
    this.children.set(pkgName, loader);
    fragmentFactory(loader);
  }

  add(modulepath: string, options: { isMain?: boolean } = {}, factory: ModuleFactory): void {
    modulepath = withoutExtension(modulepath);
    this.factories.set(modulepath, factory);
    if (options.isMain) {
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

  load<T>(loadpath: string): T {
    if (path.isAbsolute(loadpath)) {
      loadpath = path.relative('/', loadpath);
    }
    return this.loadRelative<T>('/', path.join('.', loadpath));
  }

  protected loadMain() {
    return this.load(this.main);
  }

  protected findVariant(modulepath: string): string | false {
    let variants = [ modulepath, `${ modulepath }/index` ];
    for (let variant of variants) {
      if (this.factories.has(variant)) {
        return variant;
      }
    }
  }

  loadRelative<T>(from: string, loadpath: string): T;
  loadRelative<T, U>(from: string, loadpath: string, fallback: Fallback<U>): T | U;
  loadRelative<T, U>(from: string, loadpath: string, fallback: Fallback<U> = this.fallback): T | U {
    let modulepath = path.join(from, withoutExtension(loadpath));
    let variant = this.findVariant(modulepath);
    if (!variant) {
      return fallback(this.dir(), from, loadpath);
    }
    if (!this.cache.has(variant)) {
      this.loadModule(from, variant);
    }
    return <T>this.cache.get(variant).exports;
  }

  protected loadModule(from: string, modulepath: string): void {
    let factory = this.factories.get(modulepath);
    let require = this.loadFrom.bind(this, path.dirname(modulepath));
    let dirname = path.dirname(modulepath);
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
    if (module.parent) {
      module.parent.children.push(module);
    }
  }

  protected loadPackage(loadpath: string): any {
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

  protected fallback(from: string, loadpath: string): any {
    if (from === null) {
      from = '';
    }
    from = path.join(this.dir(), from);
    if (isBuiltinModule(loadpath)) {
      return require(loadpath);
    }
    if (this.parent) {
      return this.parent.loadFrom(from, loadpath);
    }
    return require(resolve(loadpath, { basedir: from }));
  }

}