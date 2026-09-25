# แผนและสัดส่วนงาน · THAItern × IDEAX

เอกสารนี้แบ่งงานที่สร้างในรอบนี้ออกเป็น 4 Gate และบอกว่าแต่ละ Gate ใช้แรงเท่าไร ครอบคลุมอะไร และต้องผ่านอะไรก่อนขึ้น Gate ถัดไป
ผลตรวจจริงของแต่ละ Gate อยู่ใน [`VERIFICATION.md`](VERIFICATION.md)

## 1. หลักการแบ่ง

- **Gate = กลุ่มผู้ใช้** ตาม mockup: Gate 1 อาจารย์ · Gate 2 ผู้เรียน · Gate 3 SME / องค์กร และมี **Gate 0** เป็นฐานร่วมที่ทุก Gate ใช้
- **ทำทีละ Gate และต้องผ่านก่อนไปต่อ**: backend → test ของ Gate → mutation check → commit แล้วจึงเริ่ม Gate ถัดไป · หน้า UI และ E2E ทำหลัง backend ครบ แล้วไล่ตรวจทีละ Gate อีกรอบ
- **Gate ก่อนหน้าห้ามพึ่ง Gate หลัง**: เช่น การถอนความยินยอม (Gate 0) ต้องปิดคำขอติดต่อ (Gate 3) จึงใช้ hook ที่ Gate 3 ลงทะเบียนเอง ไม่ให้ Gate 0 import โค้ดของ Gate 3

## 2. สัดส่วนงานตาม Gate

วัดจากจำนวนบรรทัดที่เขียนจริง (โค้ด + test + UI) ในรอบนี้ รวมประมาณ 12,100 บรรทัด

| Gate | ขอบเขต | Backend | Test (API) | UI | รวม | สัดส่วน |
|---|---|---:|---:|---:|---:|---:|
| **0 · ฐานร่วม** | monorepo, DB adapter, migrations, สมัคร + ความยินยอม + OTP ผู้ปกครอง, audit / trace แบบแก้ไม่ได้, error มาตรฐาน, AI provider interface + mock, design system, app bar, หน้าเลือกผู้ใช้, สมัคร | 1,618 | 226 | 1,295 | 3,139 | **26%** |
| **1 · อาจารย์ (IDEAX)** | rubric, คิวตรวจ, วิเคราะห์ + anchor, ยืนยัน / ให้เกรด / ส่งกลับ / ยืนยันทั้งเกณฑ์ / ย้อนกลับ, optimistic lock, ปล่อยผลแบบ snapshot, สรุปรอบ, 4 กลุ่มความเข้าใจ | 1,264 | 302 | 676 | 2,242 | **19%** |
| **2 · ผู้เรียน** | งานในรายวิชา (precheck, คำชี้แจง AI, ใบรับงาน, ฉบับแก้, ตรวจความเข้าใจ, AI ถามกลับ) และเส้นทาง THAItern ขั้น 2–14 (เลือกเคส, ร่างแรก, บทเรียน + quiz, ปลดล็อก, Booklet ลายน้ำ, Stakeholder Chat, Canvas, Pushback, Simulator, ส่งงาน, คัดกรอง, 7-Stage, ใบรับรอง), โปรไฟล์, ผลงาน, คำขอ | 1,826 | 507 | 1,581 | 3,914 | **32%** |
| **3 · SME / องค์กร** | ผลิตเคส (ข้อตกลง, markings, ปกปิดตัวตน, ร่าง, ผู้เชี่ยวชาญ, เจ้าของอนุมัติ, ระงับ, สิ้นสุด), ตัดสิน 2 ชั้น + โควตา SME, เผยแพร่ + ค้นหา, คำขอติดต่อ, ซื้อไอเดีย, ledger | 1,073 | 516 | 791 | 2,380 | **20%** |
| E2E ทุก Gate | Playwright 15 สถานการณ์ + ภาพหน้าจอ 30 ภาพ | | | | 458 | **4%** |

**สัดส่วนตามชั้นงาน**: Backend 48% · Frontend 36% · Test (API + E2E) 17%

Gate 2 ใหญ่ที่สุดเพราะเป็นหัวใจของทั้งสองประตู: ผู้เรียนเดินเส้นทาง 14 ขั้นของ THAItern และส่งงานในรายวิชาของ IDEAX

## 3. เงื่อนไขผ่านของแต่ละ Gate (Definition of Done)

ทุก Gate ต้องครบทุกข้อก่อนขึ้น Gate ถัดไป

1. API ของ Gate ครบตาม [`APP_FLOW.md`](APP_FLOW.md) ข้อ 16
2. กฎ AC / TX ที่เกี่ยวข้องมี test ของตัวเอง และ test ผ่านทั้งบน PGlite และ PostgreSQL 16
3. **Mutation check**: ปิดกฎสำคัญทีละข้อในโค้ด แล้ว test ต้องจับได้ทุกข้อ
4. `tsc --noEmit` ไม่มี error
5. หน้า UI ของ Gate ผ่าน E2E บน production build และมีภาพหน้าจอ desktop + mobile ของหน้าหลัก
6. commit แยกต่อ Gate พร้อมข้อความที่บอกกฎที่ enforce

## 4. แบ่งบทบาทเมื่อทำเป็นทีม (ข้อเสนอสำหรับรอบถัดไป)

| บทบาท | ถือ | Gate ที่รับผิดชอบหลัก |
|---|---|---|
| Backend 1 | `apps/api/src/core`, `modules/foundation`, `modules/ideax` | 0, 1 |
| Backend 2 | `modules/thaitern`, `modules/partner`, `modules/market` | 2, 3 |
| Frontend | `apps/web` · design tokens จาก mockup | 0–3 |
| QA / Product | `apps/api/test`, `apps/web/e2e`, VERIFICATION.md | ทุก Gate |
| AI engineer | `apps/api/src/ai` · ต่อ LLM จริงแทน mock ตาม interface เดิม | 1, 2 |

## 5. งานที่เหลือ เรียงตามลำดับที่ควรทำ

| # | งาน | Gate | เหตุผล |
|---|---|---|---|
| 1 | ต่อ LLM จริงแทน `MockAiProvider` (scoring, persona, coach, pushback) และวัดความแม่นยำเทียบอาจารย์ | 1, 2 | mock ตรวจแค่คำและตัวเลข เช่น Pushback ผ่านได้ถ้าอ้างข้อมูล แม้จะตอบไม่ตรงคำถาม |
| 2 | ขั้น 10 Mentoring (Office Hour, Q&A 72 ชม., ซื้อ slot) | 2, 3 | ยังไม่ได้สร้าง · รอตัดสินใจ D7 ใน APP_FLOW |
| 3 | ขั้น 11 เครื่องมือสื่อสาร (สไลด์, วิดีโอ, Executive Email, Pitch the Board) + upload ไฟล์ | 2 | ยังไม่ได้สร้าง |
| 4 | ยืนยันตัวตนจริง (SSO มหาวิทยาลัย, AIS OTP, ตรวจบัตรโดยคน) และส่งอีเมล / SMS จริง | 0 | ตอนนี้เป็นโหมดเดโม |
| 5 | Payment gateway จริง และจ่ายเงินส่วนแบ่ง | 3 | ledger พร้อมแล้ว แต่ยังจำลองการชำระ |
| 6 | Prompt & Idea Intelligence ฝั่งอาจารย์ (มีใน mockup) | 1 | ยังไม่ได้สร้าง |
| 7 | ReviewAppeal (ปุ่ม “ชี้แจง” ใน mockup) | 1, 2 | ต้องเพิ่ม state machine ก่อน |
| 8 | Queue แยก process (Redis + BullMQ) และ deploy | 0 | ตอนนี้ queue อยู่ในโปรเซสเดียวกับ API (กู้งานค้างได้ตอนรีสตาร์ต แต่ขยายหลายเครื่องไม่ได้) |
