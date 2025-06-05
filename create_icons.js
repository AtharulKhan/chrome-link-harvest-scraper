// This script creates placeholder PNG icon files in the images directory
// Run with: node create_icons.js

const fs = require("fs");
const path = require("path");

// Base64 encoded PNG data for a simple blue square with white diamond icon
// Generated using minimal PNG data to keep the file size small
const icon16Base64 = `
iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAfElE
QVQ4y2NgGAXEAEYozcjIyPgfiP8z4gH///9nZGFh+Q/CIDEmBgYGBhYWFkai9GOzjQmXZmZmZtwa
sCnGZzMjIQtItYAJXVBbWxuvBmyOIcoFpFiA0wKQgWtra8RZgM1AXBbgjRNsFuJyBUELsLmUkAUk
xwm5CQoABHF1zmAh9REAAAAASUVORK5CYII=
`;

const icon32Base64 = `
iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAACOklE
QVRYhe2XTUhUURTHf+e+GUsnMciCGGJaFBhZi1pEQUS0KGgR1SaiRX2Q0aJFQRG0KlrUImxViyii
jRQtIopoYUUQfUBgC7NFEKlpOvP+LWbGmXlvPt9MtOkHw7v3nnvP+Z977rnnPVhmmWVyQnINOnbs
RHkl0nwMvdgOFyHoNpQWFtF4BZmvCOZV1iiuX7saOgnRwccfvJI35Nl3UBQlUtDZZzrQyv8o3lZK
7F6uVwzAvh2HqG89A8ATH3tV1D4XJ9sCUPvlPETaA31HJx4DsMUbzQRwOj5l+PEDAKrKdrHSaFx9
uDYTwFVbcJtWb58lbzsJ7oOiMAZuaAXVXZHx67bvAKB3x1GAZJrMZZ4O4GZvwjvwGCXtSQHeCymf
qdowBdvepwp5AeSZA1EDlK5zxkcnb5OMHRsfeUxs7z0AHLcnFcuVlkLejQhgXdMY2ncOgHqzjgUO
QY7rxkufgx8+AxVuZ7xqKgocsVOlA6TRQQCYwgX2D4qsOuaWVJ+yDILsOjTbFDg7OumMl9Gu0CUY
P3UHgMGxh0mHYgbinDtwX6uNUP/cAqB2aDW+Uy2kCF9CL+E1cXYRzpU4iJBnDiwBmA4gZh9Qw30A
jk/sZ9T/khmfaxqsKG+LWoTdZG4TIHcOBFoD/aHhDjob9jrj/v5LwPIEEArJ9GqoDQBebv4YaNi4
tF4QRQqSHT9x9KyLzPwBslI2FTXqjNf8NWz+Pzw68v48Ff4TiglQKZt7PYHzRYv7DLdQPC9XjGWW
WYoA/AaLI3WiSGHlXAAAAABJRU5ErkJggg==
`;

const icon48Base64 = `
iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAABmJLR0QA/wD/AP+gvaeTAAABoElE
QVRoge2ZwU7CQBCG/1m2KTcTL4oXNdGrB+PBxKvx4MWHMPEdfAkTH8KoiTcvJt5UvEC8UROlI4eW
lFIKuzOAJH6HJk0z/99ud6btAlarVasGAMw1jlEDKiuSVydKsQ0AJZyuSnJ7kQQGzvR0mqb1bDbL
4UWK0Gy1TvI8nwJYtA9oKuZ26+J5EUmSpAQOnfqvh9PT3nLf4XA4cPe1Yt6NpqTwKuZdtRbwamBF
/DgAQBCcFJgQYlBm0yRer7cEjAGjLaANZQsYbQGXbfj+DtNYQlpfCQCU+gwAtHIDYXo9NXF8DsAb
1Qop9YnzTm7Qiz4mAHDR68l1+1oSOBKnl/D9HUS9fgYA4fmZaYVo5eYvqNfPEPX6Z+Z5H1rxwBgw
2gLaULaA0Ra4uhTFuM10TngtJABe6Pus0mAa7hUAkJefyMtPUwxIAwbGgNEW0IayBYy2gMseaLWO
AQDM3A0AuG5PBwNPAMBUOOi/AwCGg/5buWdt4GYrOiWmO2ZOCQAzp7c3N6+u+xq/jVa+jebcvd9G
ACAJ/f0MfZKQJKnru1ar1aoB/AJo9EXi6zM96QAAAABJRU5ErkJggg==
`;

const icon128Base64 = `
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
AElFTkSuQmCC
`;

// Function to save base64 encoded image to file
function saveBase64Image(base64Data, outputPath) {
  // Remove line breaks and potential data URI prefix
  const cleanData = base64Data
    .replace(/\n/g, "")
    .replace(/^data:image\/png;base64,/, "");

  // Convert base64 to buffer
  const imageBuffer = Buffer.from(cleanData, "base64");

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(`Created ${outputPath}`);
}

// Create icon files
saveBase64Image(icon16Base64, path.join(__dirname, "images/icon16.png"));
saveBase64Image(icon32Base64, path.join(__dirname, "images/icon32.png"));
saveBase64Image(icon48Base64, path.join(__dirname, "images/icon48.png"));
saveBase64Image(icon128Base64, path.join(__dirname, "images/icon128.png"));

console.log("All icon files created successfully!");
