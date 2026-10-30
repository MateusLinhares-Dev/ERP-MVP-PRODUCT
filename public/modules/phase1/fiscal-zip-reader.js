/**
 * Leitor local de arquivos ZIP que contêm XML de NF-e.
 * Sem CDN e sem persistência: extrai somente entradas .xml e limita tamanho,
 * quantidade e expansão para reduzir riscos de arquivos corrompidos / zip bombs.
 * Suporta ZIP padrão (store / deflate), não ZIP64, criptografia nem ZIP multipart.
 */
const ZIP_LIMIT = 32 * 1024 * 1024;
const XML_LIMIT = 2_500_000;
const XML_COUNT_LIMIT = 300;
const TOTAL_XML_LIMIT = 30 * 1024 * 1024;
const u16 = (dv, o) => dv.getUint16(o, true);
const u32 = (dv, o) => dv.getUint32(o, true);

function textFromXml(bytes) {
  const preview = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(256, bytes.length)));
  const latin = /^\s*<\?xml[^>]*encoding\s*=\s*["'](?:ISO-8859-1|latin1|windows-1252)["']/i.test(preview);
  try { return new TextDecoder(latin ? 'windows-1252' : 'utf-8', { fatal:true }).decode(bytes); }
  catch { throw Error('Codificação XML inválida ou não suportada.'); }
}

async function inflateLimited(compressed, maxLen) {
  if (typeof DecompressionStream !== 'function') throw Error('Seu navegador não suporta a descompactação ZIP. Atualize o navegador.');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const blocks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxLen) {
        await reader.cancel().catch(() => {});
        throw Error('XML descompactado excede o limite de 2,5 MB.');
      }
      blocks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const block of blocks) { result.set(block, offset); offset += block.length; }
  return result;
}

export async function extractXmlsFromZip(file) {
  if (!file || file.size < 22 || file.size > ZIP_LIMIT) throw Error('O ZIP deve ter até 32 MB e não pode estar vazio.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of Central Directory fica nos 65.535 bytes finais (comentário ZIP opcional).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(dv, i) === 0x06054b50 && i + 22 + u16(dv, i+20) === bytes.length) { eocd=i; break; }
  }
  if (eocd < 0) throw Error('Arquivo ZIP inválido ou incompleto.');
  const records = u16(dv, eocd + 10);
  const cdSize = u32(dv, eocd + 12);
  const cdStart = u32(dv, eocd + 16);
  if (u16(dv, eocd+4) || u16(dv, eocd+6) || u16(dv,eocd+8) !== records || records === 0xffff || cdStart === 0xffffffff || cdSize === 0xffffffff) {
    throw Error('ZIP multipart e ZIP64 não são suportados.');
  }
  if (cdStart + cdSize > eocd) throw Error('Índice do ZIP corrompido.');
  let ptr = cdStart, count = 0, expanded = 0;
  const files = [], errors = [];
  for (let i = 0; i < records; i++) {
    if (ptr + 46 > eocd || u32(dv,ptr) !== 0x02014b50) throw Error('Índice de arquivos ZIP inválido.');
    const flags = u16(dv,ptr+8), method = u16(dv,ptr+10);
    const compressedSize = u32(dv,ptr+20), inflatedSize = u32(dv,ptr+24);
    const nameLength = u16(dv,ptr+28), extraLen=u16(dv,ptr+30), commentLen=u16(dv,ptr+32);
    const localOffset = u32(dv,ptr+42);
    const next = ptr + 46 + nameLength + extraLen + commentLen;
    if (next > eocd) throw Error('Nome de entrada ZIP inválido.');
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252').decode(bytes.subarray(ptr+46,ptr+46+nameLength));
    ptr=next;
    if (!name.toLowerCase().endsWith('.xml')) continue;
    count++;
    if (count > XML_COUNT_LIMIT) throw Error('Máximo de 300 XML por ZIP. Divida em arquivos menores.');
    try {
      if (nameLength > 260 || /(^\/|\\|(?:^|\/)\.\.(?:\/|$))/.test(name)) throw Error('Nome/caminho ZIP não permitido.');
      if (flags & 0x1) throw Error('ZIP criptografado não suportado.');
      if (inflatedSize > XML_LIMIT) throw Error('XML maior que 2,5 MB.');
      expanded += inflatedSize;
      if (expanded > TOTAL_XML_LIMIT) throw Error('ZIP com mais de 30 MB de XML descompactado.');
      if (![0,8].includes(method)) throw Error('Compressão ZIP não suportada.');
      if (localOffset + 30 > cdStart || u32(dv,localOffset) !== 0x04034b50) throw Error('Cabeçalho ZIP inválido.');
      const start = localOffset + 30 + u16(dv,localOffset+26) + u16(dv,localOffset+28);
      if (start + compressedSize > cdStart || compressedSize === 0xffffffff || inflatedSize === 0xffffffff) throw Error('Dados ZIP corrompidos.');
      const compressed=bytes.subarray(start,start+compressedSize);
      const xmlBytes=method===0?compressed:await inflateLimited(compressed,XML_LIMIT);
      if (xmlBytes.length !== inflatedSize || xmlBytes.length > XML_LIMIT) throw Error('Tamanho XML não corresponde ao índice ZIP.');
      files.push({ name, text: textFromXml(xmlBytes) });
    } catch (error) { errors.push({ name, message:error.message }); }
  }
  return { files, errors, totalEntries:count };
}
