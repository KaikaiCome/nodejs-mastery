// 实验：流式上传
// 目标：实现 saveUpload，详见同目录 README.md
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * 把可读流写入 destPath，同时统计字节数并计算 sha256。
 * @param {import('node:stream').Readable} source
 * @param {string} destPath
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<{ bytes: number, sha256: string }>}
 */
export async function saveUpload(source, destPath, { maxBytes = Infinity } = {}) {
  // TODO: 创建一个 Transform：累计字节数、更新哈希，超过 maxBytes 时以
  //       code = 'PAYLOAD_TOO_LARGE'、status = 413 的错误结束
  // TODO: 用 pipeline(source, transform, createWriteStream(destPath)) 串起来
  // TODO: 任何失败都要删除写了一半的 destPath，再把错误抛出去
  throw new Error('TODO: 实现 saveUpload')
}
