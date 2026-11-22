// Encoder QR Code nativo ISO/IEC 18004 (Byte Mode, ECC Level L) em JS puro -> SVG

const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

function getGeneratorPoly(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = EXP_TABLE[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function computeEcc(data, ecCount) {
  const gen = getGeneratorPoly(ecCount);
  const work = new Uint8Array(data.length + ecCount);
  work.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const coef = work[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j += 1) {
        work[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return work.slice(data.length);
}

// Tabela oficial Level L [ecPerBlock, g1Count, g1Data, g2Count, g2Data] para Versões 1..32
const LEVEL_L_BLOCKS = [
  null,
  [7, 1, 19, 0, 0],
  [10, 1, 34, 0, 0],
  [15, 1, 55, 0, 0],
  [20, 1, 80, 0, 0],
  [26, 1, 108, 0, 0],
  [18, 2, 68, 0, 0],
  [20, 2, 78, 0, 0],
  [24, 2, 97, 0, 0],
  [30, 2, 116, 0, 0],
  [18, 2, 68, 2, 69],
  [20, 4, 81, 0, 0],
  [24, 2, 92, 2, 93],
  [26, 4, 107, 0, 0],
  [30, 3, 115, 1, 116],
  [22, 5, 87, 1, 88],
  [24, 5, 98, 1, 99],
  [28, 1, 107, 5, 108],
  [30, 5, 120, 1, 121],
  [28, 3, 113, 4, 114],
  [28, 3, 107, 5, 108],
  [28, 4, 116, 4, 117],
  [28, 2, 111, 7, 112],
  [30, 4, 121, 5, 122],
  [30, 6, 117, 4, 118],
  [26, 8, 106, 4, 107],
  [28, 10, 114, 2, 115],
  [30, 8, 122, 4, 123],
  [30, 3, 117, 10, 118],
  [30, 7, 116, 7, 117],
  [30, 5, 115, 10, 116],
  [30, 13, 115, 3, 116],
  [30, 17, 115, 0, 0],
];

const ALIGNMENT_POSITIONS = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
];

// Bits de formato BCH(15,5) para ECC Level L (01) + mascara 0..7 XOR 0x5412
const FORMAT_BITS_L = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

function computeVersionInfoBits(version) {
  let d = version << 12;
  const poly = 0x1f25;
  for (let bit = 17; bit >= 12; bit -= 1) {
    if ((d >> bit) & 1) {
      d ^= poly << (bit - 12);
    }
  }
  return (version << 12) | d;
}

function getDataCapacityBytes(version) {
  const spec = LEVEL_L_BLOCKS[version];
  if (!spec) return 0;
  return spec[1] * spec[2] + spec[3] * spec[4];
}

function selectVersionForByteLength(byteLength) {
  for (let v = 1; v < LEVEL_L_BLOCKS.length; v += 1) {
    const headerBits = v <= 9 ? 4 + 8 : 4 + 16;
    const neededBytes = Math.ceil((headerBits + byteLength * 8) / 8);
    if (getDataCapacityBytes(v) >= neededBytes) {
      return v;
    }
  }
  throw new Error('Conteúdo excede a capacidade suportada do QR Code local.');
}

function encodeCodewords(bytes, version) {
  const spec = LEVEL_L_BLOCKS[version];
  const totalDataBytes = getDataCapacityBytes(version);
  const bits = [];

  const pushBits = (val, count) => {
    for (let i = count - 1; i >= 0; i -= 1) {
      bits.push((val >> i) & 1);
    }
  };

  pushBits(0b0100, 4); // Modo Byte
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i += 1) {
    pushBits(bytes[i], 8);
  }

  const maxBits = totalDataBytes * 8;
  const terminatorLen = Math.min(4, maxBits - bits.length);
  pushBits(0, terminatorLen);

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) {
      byte = (byte << 1) | bits[i + b];
    }
    dataBytes.push(byte);
  }

  let padToggle = 0;
  while (dataBytes.length < totalDataBytes) {
    dataBytes.push(padToggle % 2 === 0 ? 0xec : 0x11);
    padToggle += 1;
  }

  const [ecPerBlock, g1Count, g1Size, g2Count, g2Size] = spec;
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;

  for (let b = 0; b < g1Count; b += 1) {
    const block = Uint8Array.from(dataBytes.slice(offset, offset + g1Size));
    offset += g1Size;
    dataBlocks.push(block);
    ecBlocks.push(computeEcc(block, ecPerBlock));
  }

  for (let b = 0; b < g2Count; b += 1) {
    const block = Uint8Array.from(dataBytes.slice(offset, offset + g2Size));
    offset += g2Size;
    dataBlocks.push(block);
    ecBlocks.push(computeEcc(block, ecPerBlock));
  }

  const interleaved = [];
  const maxDataLen = Math.max(g1Size, g2Size);
  for (let i = 0; i < maxDataLen; i += 1) {
    for (let b = 0; b < dataBlocks.length; b += 1) {
      if (i < dataBlocks[b].length) {
        interleaved.push(dataBlocks[b][i]);
      }
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (let b = 0; b < ecBlocks.length; b += 1) {
      interleaved.push(ecBlocks[b][i]);
    }
  }

  return interleaved;
}

function createEmptyMatrix(size) {
  return {
    size,
    modules: Array.from({ length: size }, () => new Uint8Array(size)),
    reserved: Array.from({ length: size }, () => new Uint8Array(size)),
  };
}

function placeFinderPattern(matrix, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= matrix.size || cc < 0 || cc >= matrix.size) continue;
      matrix.reserved[rr][cc] = 1;
      const inOuter = r === 0 || r === 6 || c === 0 || c === 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const onBorder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      matrix.modules[rr][cc] = onBorder && (inOuter || inInner) ? 1 : 0;
    }
  }
}

function placeAlignmentPattern(matrix, centerR, centerC) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const rr = centerR + r;
      const cc = centerC + c;
      matrix.reserved[rr][cc] = 1;
      const isEdge = Math.abs(r) === 2 || Math.abs(c) === 2;
      const isCenter = r === 0 && c === 0;
      matrix.modules[rr][cc] = isEdge || isCenter ? 1 : 0;
    }
  }
}

function setupFunctionPatterns(version) {
  const size = 17 + version * 4;
  const matrix = createEmptyMatrix(size);

  placeFinderPattern(matrix, 0, 0);
  placeFinderPattern(matrix, 0, size - 7);
  placeFinderPattern(matrix, size - 7, 0);

  const alignCenters = ALIGNMENT_POSITIONS[version] || [];
  for (let i = 0; i < alignCenters.length; i += 1) {
    for (let j = 0; j < alignCenters.length; j += 1) {
      const r = alignCenters[i];
      const c = alignCenters[j];
      if (!matrix.reserved[r][c]) {
        placeAlignmentPattern(matrix, r, c);
      }
    }
  }

  for (let i = 8; i < size - 8; i += 1) {
    if (!matrix.reserved[6][i]) {
      matrix.reserved[6][i] = 1;
      matrix.modules[6][i] = i % 2 === 0 ? 1 : 0;
    }
    if (!matrix.reserved[i][6]) {
      matrix.reserved[i][6] = 1;
      matrix.modules[i][6] = i % 2 === 0 ? 1 : 0;
    }
  }

  // Módulo escuro fixo
  matrix.reserved[size - 8][8] = 1;
  matrix.modules[size - 8][8] = 1;

  // Reserva áreas de formato
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      matrix.reserved[8][i] = 1;
      matrix.reserved[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    matrix.reserved[8][size - 1 - i] = 1;
    matrix.reserved[size - 1 - i][8] = 1;
  }

  if (version >= 7) {
    const versionBits = computeVersionInfoBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = (versionBits >> i) & 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      matrix.reserved[r][c] = 1;
      matrix.modules[r][c] = bit;
      matrix.reserved[c][r] = 1;
      matrix.modules[c][r] = bit;
    }
  }

  return matrix;
}

function applyMaskPattern(matrix, maskId, codewords) {
  const size = matrix.size;
  const cloned = {
    size,
    modules: matrix.modules.map((row) => new Uint8Array(row)),
    reserved: matrix.reserved,
  };

  const maskFn = (r, c) => {
    switch (maskId) {
      case 0:
        return (r + c) % 2 === 0;
      case 1:
        return r % 2 === 0;
      case 2:
        return c % 3 === 0;
      case 3:
        return (r + c) % 3 === 0;
      case 4:
        return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5:
        return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6:
        return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default:
        return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let goingUp = true;

  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    for (let step = 0; step < size; step += 1) {
      const r = goingUp ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc += 1) {
        const c = col - dc;
        if (cloned.reserved[r][c]) continue;
        let bit = 0;
        if (bitIndex < totalBits) {
          const byteVal = codewords[bitIndex >> 3];
          bit = (byteVal >> (7 - (bitIndex & 7))) & 1;
          bitIndex += 1;
        }
        cloned.modules[r][c] = maskFn(r, c) ? bit ^ 1 : bit;
      }
    }
    goingUp = !goingUp;
  }

  const fmt = FORMAT_BITS_L[maskId];
  for (let i = 0; i <= 5; i += 1) {
    const bit = (fmt >> i) & 1;
    cloned.modules[i][8] = bit;
    cloned.modules[8][size - 1 - i] = bit;
  }
  cloned.modules[7][8] = (fmt >> 6) & 1;
  cloned.modules[8][size - 7] = (fmt >> 6) & 1;
  cloned.modules[8][8] = (fmt >> 7) & 1;
  cloned.modules[size - 7][8] = (fmt >> 7) & 1;
  cloned.modules[8][7] = (fmt >> 8) & 1;
  cloned.modules[size - 6][8] = (fmt >> 8) & 1;

  for (let i = 9; i < 15; i += 1) {
    const bit = (fmt >> i) & 1;
    cloned.modules[8][14 - i] = bit;
    cloned.modules[size - 15 + i][8] = bit;
  }

  return cloned;
}

function scorePenalty(modules) {
  const n = modules.length;
  let penalty = 0;

  for (let r = 0; r < n; r += 1) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < n; c += 1) {
      if (modules[r][c] === runColor) {
        runLen += 1;
        if (runLen === 5) penalty += 3;
        else if (runLen > 5) penalty += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }

  for (let c = 0; c < n; c += 1) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < n; r += 1) {
      if (modules[r][c] === runColor) {
        runLen += 1;
        if (runLen === 5) penalty += 3;
        else if (runLen > 5) penalty += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }

  let darkCount = 0;
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (modules[r][c]) darkCount += 1;
      if (r < n - 1 && c < n - 1) {
        const sum =
          modules[r][c] +
          modules[r + 1][c] +
          modules[r][c + 1] +
          modules[r + 1][c + 1];
        if (sum === 0 || sum === 4) penalty += 3;
      }
    }
  }

  const ratio = Math.abs((darkCount * 100) / (n * n) - 50);
  penalty += Math.floor(ratio / 5) * 10;
  return penalty;
}

export function generateQrCodeMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const version = selectVersionForByteLength(bytes.length);
  const codewords = encodeCodewords(bytes, version);
  const baseMatrix = setupFunctionPatterns(version);

  let best = null;
  let bestScore = Infinity;
  for (let maskId = 0; maskId < 8; maskId += 1) {
    const candidate = applyMaskPattern(baseMatrix, maskId, codewords);
    const penalty = scorePenalty(candidate.modules);
    if (penalty < bestScore) {
      bestScore = penalty;
      best = candidate;
    }
  }

  return {
    version,
    size: best.size,
    modules: best.modules,
  };
}

export function generateQrCodeSvg(
  text,
  {
    margin = 2,
    size = 220,
    darkColor = '#111111',
    lightColor = '#FFFFFF',
    ariaLabel = 'QR Code do perfil público',
  } = {}
) {
  const { size: matrixSize, modules, version } = generateQrCodeMatrix(text);
  const viewSize = matrixSize + margin * 2;
  const parts = [];

  for (let r = 0; r < matrixSize; r += 1) {
    for (let c = 0; c < matrixSize; c += 1) {
      if (modules[r][c]) {
        parts.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${size}" height="${size}" role="img" aria-label="${ariaLabel.replace(/"/g, '&quot;')}" shape-rendering="crispEdges">`,
    `<rect width="${viewSize}" height="${viewSize}" fill="${lightColor}" />`,
    `<path d="${parts.join('')}" fill="${darkColor}" />`,
    `</svg>`,
  ].join('');

  return {
    svg,
    version,
    matrixSize,
    viewSize,
    pathData: parts.join(''),
  };
}
