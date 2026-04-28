#!/usr/bin/env node

/**
 * EGX Investment Platform - Favicon Generator
 *
 * Reads the stock market / bull theme JPEG and creates all required
 * favicon and PWA icon sizes. Uses sharp for high-quality resizing.
 *
 * Usage: node scripts/create-favicon.mjs
 */

import sharp from "sharp";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const SOURCE_IMAGE = resolve(PROJECT_ROOT, "upload/pexels-pixabay-260024.jpg");
const OUTPUT_DIR = resolve(PROJECT_ROOT, "public");

// Ensure output directory exists
mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Create a proper ICO file from a PNG buffer.
 * ICO format: 6-byte header + 16-byte directory entry + PNG data
 */
function createIcoFromPng(pngBuffer, size) {
  const imageSize = pngBuffer.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dataOffset = headerSize + dirEntrySize;

  const buffer = Buffer.alloc(headerSize + dirEntrySize + imageSize);

  // ICO Header (6 bytes)
  buffer.writeUInt16LE(0, 0);       // Reserved (must be 0)
  buffer.writeUInt16LE(1, 2);       // Type: 1 = ICO
  buffer.writeUInt16LE(1, 4);       // Number of images

  // Directory Entry (16 bytes)
  buffer.writeUInt8(size >= 256 ? 0 : size, 0 + headerSize);  // Width (0 = 256+)
  buffer.writeUInt8(size >= 256 ? 0 : size, 1 + headerSize);  // Height (0 = 256+)
  buffer.writeUInt8(0, 2 + headerSize);   // Color palette count (0 = no palette)
  buffer.writeUInt8(0, 3 + headerSize);   // Reserved
  buffer.writeUInt16LE(1, 4 + headerSize);  // Color planes
  buffer.writeUInt16LE(32, 6 + headerSize); // Bits per pixel
  buffer.writeUInt32LE(imageSize, 8 + headerSize); // Image data size
  buffer.writeUInt32LE(dataOffset, 12 + headerSize); // Offset to image data

  // Copy PNG data
  pngBuffer.copy(buffer, dataOffset);

  return buffer;
}

async function main() {
  console.log("=== EGX Favicon Generator ===\n");

  // Step 1: Read source image and get metadata
  console.log(`Source: ${SOURCE_IMAGE}`);
  const metadata = await sharp(SOURCE_IMAGE).metadata();
  console.log(`Original size: ${metadata.width}x${metadata.height} (${metadata.format})\n`);

  // Step 2: Center-crop to square
  // Since the image is landscape (3089x2114), we crop to min dimension (2114)
  const minDim = Math.min(metadata.width, metadata.height);
  const cropX = Math.floor((metadata.width - minDim) / 2);
  const cropY = Math.floor((metadata.height - minDim) / 2);

  console.log(`Center-cropping to ${minDim}x${minDim} (offset: ${cropX},${cropY})\n`);

  // Define output files
  const outputs = [
    { name: "favicon-16x16.png",   size: 16,   format: "png" },
    { name: "favicon-32x32.png",   size: 32,   format: "png" },
    { name: "apple-touch-icon.png", size: 180, format: "png" },
    { name: "icon-192x192.png",     size: 192, format: "png" },
    { name: "icon-512x512.png",     size: 512, format: "png" },
  ];

  // Step 3: Generate all PNG sizes
  for (const output of outputs) {
    const outPath = resolve(OUTPUT_DIR, output.name);

    await sharp(SOURCE_IMAGE)
      .extract({ left: cropX, top: cropY, width: minDim, height: minDim })
      .resize(output.size, output.size, {
        fit: "cover",
        kernel: "lanczos3",
      })
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
      })
      .toFile(outPath);

    const stats = await sharp(outPath).metadata();
    console.log(`  Created: ${output.name.padEnd(24)} (${stats.width}x${stats.height}, ${(stats.size / 1024).toFixed(1)} KB)`);
  }

  // Step 4: Generate favicon.ico (32x32 PNG wrapped in ICO container)
  console.log("");
  const png32Buffer = await sharp(SOURCE_IMAGE)
    .extract({ left: cropX, top: cropY, width: minDim, height: minDim })
    .resize(32, 32, {
      fit: "cover",
      kernel: "lanczos3",
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toBuffer();

  const icoBuffer = createIcoFromPng(png32Buffer, 32);
  const icoPath = resolve(OUTPUT_DIR, "favicon.ico");
  writeFileSync(icoPath, icoBuffer);
  console.log(`  Created: favicon.ico${" ".repeat(18)} (${32}x${32}, ${(icoBuffer.length / 1024).toFixed(1)} KB)`);

  console.log("\n=== All favicons generated successfully! ===");
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("Error generating favicons:", err);
  process.exit(1);
});
