// 参考实现：流式保存上传文件
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function saveUpload(source, destPath, { maxBytes = Infinity } = {}) {
  const hash = createHash('sha256')
  let bytes = 0

  const meter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        const err = new Error(`上传内容超过 ${maxBytes} 字节`)
        err.code = 'PAYLOAD_TOO_LARGE'
        err.status = 413
        return callback(err)
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  try {
    // pipeline 负责背压，并在任一环节出错时销毁所有流
    await pipeline(source, meter, createWriteStream(destPath))
  } catch (err) {
    await rm(destPath, { force: true })
    throw err
  }
  return { bytes, sha256: hash.digest('hex') }
}
