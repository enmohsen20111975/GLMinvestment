#!/usr/bin/env node
/**
 * extract-lessons.js — Convert LESSONS array in AcademyEncyclopedia.tsx
 * to a clean JSON file under messages/academy-lessons.json
 *
 * Strategy: use TypeScript compiler API to parse the file, locate the
 * LESSONS const declaration, and serialize the object literal to JSON.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const srcFile = path.resolve(
  __dirname,
  '../src/modules/education/components/AcademyEncyclopedia.tsx',
);
const outAr = path.resolve(__dirname, '../messages/academy-lessons.ar.json');
const outEn = path.resolve(__dirname, '../messages/academy-lessons.en.json');

const sourceText = fs.readFileSync(srcFile, 'utf8');
const sourceFile = ts.createSourceFile(
  srcFile,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function nodeToObject(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const obj = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = prop.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
        obj[name] = nodeToObject(prop.initializer);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        obj[prop.name.getText(sourceFile)] = undefined;
      }
    }
    return obj;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => nodeToObject(e));
  }
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) {
    // for enum-like values just return the identifier text
    return node.getText(sourceFile);
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.getText(sourceFile);
  }
  if (ts.isAsExpression(node)) {
    return nodeToObject(node.expression);
  }
  if (ts.isNonNullExpression(node)) {
    return nodeToObject(node.expression);
  }
  // fallback: raw text
  return node.getText(sourceFile);
}

let lessonsArray = null;
function visit(node) {
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.length > 0
  ) {
    const decl = node.declarationList.declarations[0];
    const name = decl.name.getText(sourceFile);
    if (name === 'LESSONS' && decl.initializer) {
      lessonsArray = nodeToObject(decl.initializer);
    }
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);

if (!lessonsArray) {
  console.error('LESSONS array not found');
  process.exit(1);
}

// Build Arabic version (preserve all original Arabic content)
const ar = { lessons: lessonsArray };

// Build English version: use titleEn as title, leave body content as-is
// (Arabic content will be served for now; full English translation is Round 3 work)
const en = {
  lessons: lessonsArray.map((l) => ({
    ...l,
    // Override title with the existing titleEn so English users see English titles
    title: l.titleEn || l.title,
  })),
};

fs.mkdirSync(path.dirname(outAr), { recursive: true });
fs.writeFileSync(outAr, JSON.stringify(ar, null, 2) + '\n', 'utf8');
fs.writeFileSync(outEn, JSON.stringify(en, null, 2) + '\n', 'utf8');

console.log(`Wrote ${outAr} (${ar.lessons.length} lessons)`);
console.log(`Wrote ${outEn} (${en.lessons.length} lessons)`);
