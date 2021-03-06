import PugBase from './pug-base';
import config from '../tasks-config';
import { join, relative, dirname } from 'path';
import CacheBuster from './utility/cache-buster';
import { errorLog } from './utility/error-log';
import { readFileSync } from './utility/fs';
import { mkfile, sameFile } from './utility/file';
import { fileLog } from './utility/file-log';
import { encodeLineFeedCode } from './utility/line-feed-code';
import { toRelativePath, cacheBuster } from './utility/path-convert';
import { getType } from './utility/type';
import pug from 'pug';
import iconv from 'iconv-lite';

export default class PugFactory extends PugBase {

  constructor() {
    super('pug-factory');
    const { cacheBusterExts } = config.pug;
    this._cacheBuster = cacheBusterExts.length ? new CacheBuster(cacheBusterExts) : null;
  }

  _watch() {
    const { tmp, factory } = config.pug;

    // init
    this._watchInit(join(factory, '**/*.+(pug|json)'));

    // factory json
    this._watchSrc(join(factory, '**/*.json'));

    // factory template
    this._watchOther(join(factory, '**/*.pug'));

    // extend or include
    this._watchOther(join(tmp, '**/*.pug'));

    // cache buster
    const { _cacheBuster } = this;
    if(_cacheBuster) {
      const _target = (() => {
        const { htdocs } = config.project;
        const { cacheBusterExts } = config.pug;
        const { exts } = this;
        const _extsStr = cacheBusterExts.reduce((memo, ext, i) => {
          if(i) memo += '|';
          memo += ext;
          return memo;
        }, '');
        return `${ htdocs }/**/*.+(${ _extsStr })`;
      })();
      this._watchInit(_target);
      this._watchOther(_target);
    }
  }

  /**
   * @return {Promsie}
   */
  _buildAll() {
    const { factory } = config.pug;
    return super._buildAll('pug', join(factory, '**/*.json'), true);
  }

  /**
   * @param {string} path
   * @return {Promise}
   */
  _build(path) {
    const { argv, isFirstBuild } = NS;
    const {
      project: { htdocs },
      pug    : { charset, lineFeedCode, root, src, dest, relativePath },
    } = config;
    const { pugSet } = NS.curtFiles;
    const { _pugOpts } = this;

    const _buf = readFileSync(path, (err) => errorLog('pug-factory', err));
    if(!_buf) return;

    const _tmps = (() => {
      try {
        return JSON.parse(_buf.toString());
      }
      catch(e) {
        console.log(e);
        return null;
      }
    })();
    if(!_tmps) return;

    return (async () => {
      await Promise.all(Object.entries(_tmps).map(([tmpPath, pages]) => {
        const _path   = join(root, `${ tmpPath }.pug`);
        const _tmpBuf = readFileSync(_path, (err) => errorLog('pug-factory', err));
        if(!_tmpBuf) return;

        const _tmp      = _tmpBuf.toString();
        const _splitTmp = _tmp.split('{{vars}}');

        return (async () => {
          await Promise.all(Object.entries(pages).map(([srcPath, vals]) => {
            const _srcPath = `${ srcPath }.pug`;

            return (async () => {
              if(!isFirstBuild && (argv['viewing-update'] || argv['viewing-update-pug'])) {
                if(!pugSet.has(_srcPath)) return;
              }

              const _valsStr = Object.entries(vals).reduce((memo, [key, val]) => {
                return `${ memo }  - var ${ key } = ${ JSON.stringify(val) }\n`;
              }, '');
              const _contents = _splitTmp[0] + _valsStr + _splitTmp[1];
              const _members  = this._getMembers(join(src, _srcPath));
              const _opts     = Object.assign(_pugOpts, _members);
              const _html = await new Promise((resolve, reject) => {
                pug.render(_contents, _opts, (err, html) => {
                  if(err) return reject(err);
                  resolve(html);
                });
              })
                .catch((err) => {
                  errorLog('pug-factory', err.message);
                });
              if(!_html) return;

              const _ext  = this._getExt(_srcPath);
              const _dest = join(dest, _srcPath).replace('.pug', _ext);
              let _buf    = new Buffer(_html);

              if(relativePath) {
                const _rootDirname = `/${ dirname(relative(htdocs, _dest)) }`;
                _buf = toRelativePath(_buf, _rootDirname);
              }

              const { _cacheBuster } = this;
              if(_cacheBuster) {
                _buf = _cacheBuster.start(_buf, _dest);
              }

              _buf = encodeLineFeedCode(_buf, lineFeedCode);

              if(charset !== 'utf8') {
                _buf = iconv.encode(_buf, charset);
              }

              if(!sameFile(_dest, _buf)) {
                await mkfile(_dest, _buf);
                fileLog('create', _dest);
              }
            })();
          }));
        })();
      }));
    })();
  }

}
