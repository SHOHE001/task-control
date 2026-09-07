/* global document */
import { Buffer } from "node:buffer";
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
for (const size of [192, 512]) {
  const png = await page.evaluate((size) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const c = canvas.getContext("2d");
    c.scale(size / 512, size / 512);
    c.fillStyle = "#285e50";
    c.fillRect(0, 0, 512, 512);
    c.strokeStyle = "#fffdf5";
    c.lineWidth = 35;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(132, 264);
    c.lineTo(374, 264);
    c.moveTo(280, 168);
    c.lineTo(376, 264);
    c.lineTo(280, 360);
    c.stroke();
    return canvas.toDataURL("image/png").split(",")[1];
  }, size);
  writeFileSync(`web/public/icon-${size}.png`, Buffer.from(png, "base64"));
}
await browser.close();
