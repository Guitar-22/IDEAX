# IDEAX · THAItern

**หนึ่งเครื่องยนต์ สองประตู** — THAItern ให้ผู้เรียนทั่วประเทศฝึกคิดกับโจทย์จริงของ SMEs และชุมชน · IDEAX ให้อาจารย์เห็นกระบวนการคิดกับ AI ของนักศึกษา

| เอกสาร | เนื้อหา |
|---|---|
| [`docs/APP_FLOW.md`](docs/APP_FLOW.md) | App Flow ตั้งแต่ Frontend ถึง Backend |
| [`docs/WORK_PLAN.md`](docs/WORK_PLAN.md) | สัดส่วนงานทีละ Gate และงานที่เหลือ |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | ผลตรวจความถูกต้องทีละ Gate |
| [`docs/PERSONA_USECASES.md`](docs/PERSONA_USECASES.md) | Persona 10 คน · Use Case 110 ข้อครบ 12 Loop · Journey Map และ Backlog UX/UI |
| [`docs/screenshots/`](docs/screenshots) | ภาพหน้าจอจาก E2E |
| [`IDEAX-3Gate-mockup.html`](IDEAX-3Gate-mockup.html) | mockup ต้นแบบ (เปิดในเบราว์เซอร์ได้ทันที) |

## โครงสร้าง

```
packages/contracts   ชนิดข้อมูลและสถานะที่ frontend กับ backend ใช้ร่วมกัน
apps/api             Fastify + PostgreSQL (PGlite สำหรับ dev/test) · แบ่ง module ตาม Gate
  src/modules/foundation, consent   Gate 0 · ตัวตน ความยินยอม บันทึกระบบ
  src/modules/ideax                 Gate 1 อาจารย์ + งานในรายวิชาของ Gate 2
  src/modules/thaitern              Gate 2 · เส้นทางผู้เรียน 14 ขั้น
  src/modules/partner, market       Gate 3 · ผลิตเคส ตัดสินผลงาน เผยแพร่ องค์กร
  src/ai                            AiProvider interface + MockAiProvider (ยังไม่ใช่ LLM จริง)
  test/gate0…gate3                  API test ทีละ Gate
apps/web             Next.js · หน้าจอทุก Gate (design tokens จาก mockup)
  e2e/gate0…gate3                   Playwright ทีละ Gate
```

## เริ่มใช้งาน

ต้องใช้ Node.js 22

```bash
npm install
npm run dev:api        # API ที่ :4000 · ฐานข้อมูลในหน่วยความจำ + ข้อมูลเดโม
npm run dev:web        # หน้าเว็บที่ :3000
```

เปิด http://localhost:3000 แล้วเลือกผู้ใช้เดโมของแต่ละ Gate · ผู้ใช้ ร้าน และชุมชนทั้งหมดเป็นข้อมูลสมมติ

ใช้ PostgreSQL จริง: `DATABASE_URL=postgres://… npm run dev:api` · เก็บข้อมูลลงดิสก์แบบไม่ใช้เซิร์ฟเวอร์: `PGLITE_DIR=./apps/api/.data npm run dev:api`

## ตรวจความถูกต้อง

```bash
npm test               # API test ทุก Gate
npm run test:gate2     # ทีละ Gate
npm run test:pg        # บน PostgreSQL 16
npm run typecheck
npm run build -w @ideax/web && npm run e2e
```
