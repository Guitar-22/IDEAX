# ผลตรวจความถูกต้องทีละ Gate

ตรวจเมื่อ 25 ก.ย. 2569 บน branch `claudy/clever-ptolemy-kfrvbc` · วิธีรันซ้ำอยู่ท้ายเอกสาร

## สรุป

| Gate | API test | Mutation check | E2E (UI จริง) | สถานะ |
|---|---:|---|---:|---|
| 0 · ฐานร่วม | 17 / 17 | – | 4 / 4 | ผ่าน |
| 1 · อาจารย์ | 22 / 22 | 4 / 4 กฎถูกจับได้ | 3 / 3 | ผ่าน |
| 2 · ผู้เรียน | 32 / 32 | 5 / 5 กฎถูกจับได้ | 4 / 4 | ผ่าน |
| 3 · SME / องค์กร | 33 / 33 | 6 / 6 กฎถูกจับได้ | 4 / 4 | ผ่าน |
| **รวม** | **104 / 104** | **15 / 15** | **15 / 15** | |

- API test รันผ่านทั้งบน **PGlite** (Postgres ในโปรเซส) และ **PostgreSQL 16** จริง (`npm run test:pg`)
- `tsc --noEmit` ผ่านทั้ง `apps/api` และ `apps/web` · `next build` ผ่าน 22 หน้า
- E2E รันบน production build ของหน้าเว็บ + API ที่ seed ใหม่ทุกครั้ง · ภาพหน้าจออยู่ใน [`screenshots/`](screenshots)

**Mutation check** คือการแกล้งปิดกฎในโค้ดทีละข้อ (เช่นลบเงื่อนไขบังคับเหตุผล) แล้วรัน test ถ้า test ยังผ่านแปลว่า test ไม่ได้ตรวจกฎนั้นจริง · ทุกกฎที่ลองปิด test จับได้หมด และคืนโค้ดเดิมหลังตรวจทุกครั้ง

---

## Gate 0 · ฐานระบบร่วม

| กฎ | ตรวจด้วย |
|---|---|
| ต้องยอมรับ 3 ข้อบังคับก่อนสมัคร (ภาคผนวก ข) | `gate0 › refuses signup without the 3 mandatory consents` · E2E ปุ่มสมัครกดไม่ได้จนติ๊กครบ |
| ผู้เยาว์ต้องมีเบอร์และ OTP ผู้ปกครอง, รหัสหมดอายุ 10 นาที, ผิด 5 ครั้งล็อก (TX-12) | `gate0 › requires a guardian phone…`, `…locks after 5 wrong tries`, `…expired OTP` · E2E ผู้เยาว์สมัครและผู้ปกครองยืนยัน |
| ความยินยอมเป็น ledger เก็บทุกครั้งที่ให้และถอน | `gate0 › give and withdraw… (ledger keeps both)` |
| audit_log, trace_events, consent_records แก้หรือลบไม่ได้ | `gate0 › blocks UPDATE and DELETE…` (trigger ในฐานข้อมูล) |
| ผู้เรียนเห็นบันทึกระบบเฉพาะของตัวเอง | `gate0 › shows staff the whole log but a learner only their own rows` |
| correlation id ไหลจาก request ถึง audit, error ไม่โชว์ข้อความดิบ | `gate0 › echoes a valid correlation id…` · E2E บันทึกระบบมี `cid-` |
| หน้าเว็บเรียก PUT / DELETE ข้าม origin ได้ | `gate0 › allows the browser app to PUT and DELETE…` |
| รีสตาร์ต API แล้วงาน AI ที่ค้างกลับเข้าคิว | `gate0 › re-queues unfinished AI jobs on boot…` |

## Gate 1 · อาจารย์ (IDEAX)

| กฎ | ตรวจด้วย |
|---|---|
| ข้อเสนอที่ชี้กลับไปยังข้อความไม่ได้ต้องไม่แสดง (AC-03) | `gate1 › only shows anchors that point at the exact text` · `drops a proposal whose anchor does not match… claim_dropped` |
| ส่วนที่อ่านไม่ได้ / ไม่ได้ส่ง ไม่มีข้อเสนอ (AC-10) | `gate1 › shows 16 items… 3 items that need a human` (2.4 บทอื่น, 3.2 รูปไม่มีข้อความ, 4.4 ไม่มีรายการอ้างอิง) |
| ต้นฉบับไม่ระบุน้ำหนัก → ถ่วงเท่ากัน (AC-04) | `gate1 › averages only verified items, equal weights…` · snapshot มี `weighting: equal` |
| ให้เกรดต่างจาก AI ต้องมีเหตุผล · ข้อที่ไม่มีข้อเสนอเป็น `human_only` | `gate1 › requires a one-line reason…`, `grades an item with no proposal…` · E2E ปุ่มบันทึกกดไม่ได้จนมีเหตุผล |
| ส่งกลับให้แก้ = ไม่มีเกรด ไม่นับเป็น F | `gate1 › returns an item for revision with no grade…` |
| แก้พร้อมกันไม่เขียนทับ (AC-11) | `gate1 › does not let a second reviewer overwrite silently` · E2E หน้าต่าง “มีคนแก้ผลชิ้นนี้พร้อมกับคุณ” |
| ยืนยันทั้งเกณฑ์ = การตัดสินใจครั้งเดียว | `gate1 › bulk-accepts… as ONE decision` (1 audit, 1 decision) |
| ผู้เรียนเห็นเฉพาะผลที่ปล่อย ไม่มีเหตุผลของ AI (AC-12) | `gate1 › learner sees nothing before release`, `releases an immutable snapshot…` |
| ผู้ช่วยตรวจปล่อยผลไม่ได้ · ปล่อยแล้วแก้ไม่ได้ | `gate1 › refuses release… to the marker`, `locks every item after release…` |
| AI ล่มถาวร → ตรวจแบบไม่มีข้อเสนอ | `gate1 › when AI stays down, retries then abandons…` |

Mutation check: ปิดกฎเหตุผล · ปิด optimistic lock · ปล่อยผลทั้งที่มีข้อค้าง · ส่งกลับแล้วยังเก็บเกรด → test ล้มทุกกรณี

## Gate 2 · ผู้เรียน

| กฎ | ตรวจด้วย |
|---|---|
| ส่งงานได้และได้ใบรับงานแม้ AI ล่ม (AC-01) | `gate2.coursework › keeps the receipt when AI is down…` · `gate2.journey › …issues a receipt even with AI down` |
| Precheck เป็นคำแนะนำ ไม่มีเปอร์เซ็นต์ ไม่มีผลทางการ | `gate2.coursework › precheck is advisory…` · E2E ไม่มีตัวเลข % บนหน้า |
| ต้องมีคำชี้แจงการใช้ AI และ precheck ใหม่ก่อนส่งฉบับแก้ · ฉบับเดิมยังอยู่ | `…blocks submit until an AI disclosure…`, `…revises and keeps version 1` |
| AI ในแพลตฟอร์มถามกลับ ไม่เขียนแทน (TX-08, TX-19) | `…Socratic replies, recorded, 503 when AI is down` · `coach asks questions and never writes the canvas` |
| Verification mode บันทึกแต่ไม่ลงโทษ (TX-20) · ปิดการวางข้อความ | `…records verification-mode integrity events…` · E2E ช่องคำตอบไม่รับการวาง |
| เลือกได้ 1 แห่งต่อรอบ ไม่เห็นปัญหาก่อนเลือก (TX-02) | `gate2.journey › shows teasers without the real problem`, `…exactly one place per round` · E2E การ์ดไม่มีโจทย์ |
| ลำดับขั้นบังคับที่ server | `…enforces the step order on the server` |
| บทเรียนครบ + quiz ≥ 80% + รหัส → ปลดล็อก | `…only after all sessions and a quiz ≥ 80%, with a code` (70% ไม่ผ่าน) |
| บัตรนักศึกษาครบทีม + ผู้ปกครองยินยอม (TX-03, TX-12) | `…requires a verified student card and guardian consent…` |
| ทีมไม่เกิน 4 คน (TX-06) | `…caps teams at 4 members` |
| นับ 14 วันจากปลดล็อก แล้วหมดเวลา (TX-04) | `…expires an attempt 14 days after unlock…` |
| Booklet อ่านบนเว็บ มีลายน้ำ ไม่มีลิงก์ดาวน์โหลด ตรวจการเข้าใช้ผิดปกติ (TX-05) | `…web with a personal watermark…`, `…flags abnormal booklet access` · E2E ลายน้ำมีชื่อผู้เรียน |
| Stakeholder Chat สตรีมและตอบจากข้อมูลในเคสเท่านั้น | `…streams Stakeholder Chat as SSE…` · E2E พี่ต้นตอบเรื่องการหมัก |
| Pushback ผ่านเมื่ออ้างข้อมูล | `…only passes a data-backed defence` |
| ผลคัดกรอง AI ไม่แสดงเป็นผล · คำพูดที่ยกมาต้องมีอยู่จริงในงาน | `…every quoted line exists in the work (AC-03)` |
| ผ่าน Stage = Solo 2 ครั้งติดใน 2 อุตสาหกรรม (TX-01) · Sawtooth | `gate2.journey › masters a stage only after…`, `fades support… (Sawtooth)` |
| ใบรับรองออกหลังตอบคำถามตรวจความเข้าใจ | `…issues a certificate after the understanding check` · E2E ได้ใบรับรองและตรวจสอบสาธารณะได้ |

Mutation check: เลือกได้หลายที่ · ไม่หมดเวลา 14 วัน · อุตสาหกรรมเดียวกันก็ผ่าน Stage · ไม่เช็คบัตร · quiz 70% ก็ผ่าน → test ล้มทุกกรณี

## Gate 3 · SME / องค์กร

| กฎ | ตรวจด้วย |
|---|---|
| ต้องลงนามข้อตกลงก่อนส่งข้อมูล | `gate3.partner › refuses data before the owner signs the licence…` |
| ปกปิดตัวตนก่อนร่าง · ข้อมูล no_learner / pii / หมดอายุ ไม่เข้า Booklet (TX-14) | `…nothing identifying or held back reaches learners` · E2E เห็น `[เบอร์โทร]` |
| ผู้เชี่ยวชาญตรวจก่อน และมีชื่อบนเคส (TX-17) | `…needs an expert, then the owner…` |
| ระงับเคส: ห้ามปลดล็อกใหม่ ทีมที่เริ่มแล้วทำต่อ (TX-15) | `…takedown stops new unlocks but lets running teams finish` |
| สิ้นสุดข้อตกลง → ลบข้อมูลดิบ | `…retiring destroys the raw data` |
| SME อ่านเฉพาะงานที่ผ่านคัดกรอง สัปดาห์ละ 3 (TX-11) | `…max 3 new reads a week` (ชิ้นที่ 4 ได้ 429 · สัปดาห์ถัดไปอ่านได้) |
| กรรมการยืนยันครบทุกเกณฑ์ เปลี่ยนจาก AI ต้องมีเหตุผล | `…judges confirm every criterion…` |
| ปล่อยผลเมื่อยืนยันครบทุกทีม ทุกทีมได้ Feedback (TX-10) | `…releases only when every team is confirmed…` |
| ห้ามเผยแพร่เกรด / ข้อเสนอ AI · ต้องมีสิ่งที่มนุษย์รับรอง | `gate3.market › refuses forbidden fields…`, `…nothing human has verified…` |
| ห้ามคัดลอกข้อความลับจาก Booklet ลงการ์ด | `…refuses text copied from the owner’s booklet` · `detects Thai text copied…` |
| งานทีมเผยแพร่เมื่อทุกคนยินยอม (AC-05) | `…waits for every co-author…` |
| ค้นได้เฉพาะ publication projection (AC-06) · ระดับ link / org | `…keeps drafts and private coursework out of search`, `…link-only… org-only…` · E2E การ์ดไม่มีเกรด |
| ข้อมูลติดต่อเปิดหลังเจ้าของยอมและชำระแล้ว (AC-07) · ต้องมี consent Talent Matching (TX-13) | `…opens contact only after the owner accepts AND the unlock is paid…`, `…needs the owner’s talent-matching consent…`, `…closes pending requests when… withdrawn` · E2E ครบทั้งเส้นทาง |
| ถอนแล้วหายจากการค้นหา ลิงก์ตอบ 410 (AC-08) | `…withdrawal removes the work from search…` |
| ซื้อไอเดีย: เจ้าของอนุมัติก่อนตัดเงิน · ผู้เรียนได้ 40% · ledger สมดุล | `…owner approves before any money moves…`, `splits an idea purchase 40%…` |

Mutation check: ค้นได้ทุก visibility · เปิดข้อมูลติดต่อก่อนจ่าย · ถอนแล้วไม่ลบ index · ไม่มีโควตา SME · ไม่ต้องมีผู้เชี่ยวชาญ · ไม่รอผู้ร่วมจัดทำ → test ล้มทุกกรณี

---

## บั๊กที่พบระหว่างไล่ตรวจ และแก้แล้ว

| # | Gate | พบจาก | ปัญหา | แก้ |
|---|---|---|---|---|
| 1 | 0 | API test | Gate 0 (ถอนความยินยอม) เขียนตรงเข้าตารางของ Gate 3 ทำให้ Gate แรกพังถ้าไม่มี Gate หลัง | ใช้ hook ที่ Gate 3 ลงทะเบียนเอง |
| 2 | 0 | API test | ความยินยอมสองครั้งในเวลาเดียวกันอ่านสถานะล่าสุดไม่แน่นอน | เรียงด้วยลำดับ `seq` แทนเวลา |
| 3 | 2 | API test | seed ใช้เวลาของฐานข้อมูล (`now()`) ปนกับเวลาของระบบ ทำให้กฎ “ต้อง precheck ใหม่” ไม่ทำงาน | ใช้นาฬิกาของระบบทุกจุด |
| 4 | 3 | API test | ตัวตรวจการคัดลอกข้อความลับใช้การตัดประโยคด้วยจุด ภาษาไทยไม่มีจุด จึงคัดลอกบางส่วนแล้วหลุด | เทียบวลีที่คั่นด้วยช่องว่าง + test ภาษาไทย |
| 5 | 0 | E2E | CORS อนุญาตแค่ GET/POST หน้าเว็บจึงบันทึกร่าง Canvas และคำชี้แจงไม่ได้ (API test มองไม่เห็นเพราะไม่ผ่านเบราว์เซอร์) | เปิด PUT / DELETE + test preflight |
| 6 | 0 | E2E | หลังผู้ปกครองยืนยัน OTP หน้าแรกยังขึ้นว่ารอความยินยอม | โหลดข้อมูลบัญชีใหม่ก่อนเปลี่ยนหน้า |
| 7 | 0 | E2E | label ของช่องกรอกไม่ผูกกับช่อง (โปรแกรมอ่านหน้าจอใช้ไม่ได้) | ผูก `htmlFor` / `id` อัตโนมัติ |
| 8 | 3 | E2E | สร้างร่างเคสแล้ว UI ไม่บอกว่าไปถึงขั้นไหน | API คืนสถานะใหม่ |
| 9 | 2 | ภาพหน้าจอ | แถบขั้นตอนชี้ขั้น 7 ทั้งที่เพิ่งปลดล็อก | ชี้ขั้น 6 |
| 10 | 0 | ภาพหน้าจอ | แถบบนบนมือถือกินพื้นที่เกินครึ่งจอ | ย่อแถบบนสำหรับจอ ≤ 640px |
| 11 | 0 | ทบทวนข้อจำกัด | queue ในโปรเซสทำให้งานวิเคราะห์หายถ้ารีสตาร์ต | หยิบงานที่ค้างกลับเข้าคิวตอนเริ่มระบบ + test |

## ข้อจำกัดที่ยังอยู่ (ยังไม่ใช่ของจริง)

- **AI เป็น mock แบบกฎ** (`MockAiProvider`) ผลคงที่ทุกครั้งเพื่อให้ทดสอบได้ แต่ไม่ได้เข้าใจเนื้อหา เช่น Pushback จะผ่านถ้าคำตอบอ้างข้อมูลและยาวพอ แม้จะตอบไม่ตรงข้อโต้แย้ง · ต้องต่อ LLM จริงผ่าน `AiProvider` แล้ววัดความแม่นยำเทียบอาจารย์ก่อนใช้จริง
- **ยืนยันตัวตน / OTP / อีเมล / การชำระเงิน เป็นโหมดเดโม**: OTP และรหัสปลดล็อกแสดงบนหน้าจอเมื่อเปิด dev tools, บัตรนักศึกษาผ่านทันทีเมื่ออัปโหลด, การชำระเงินบันทึกใน ledger โดยไม่ผ่าน gateway
- **ยังไม่ได้สร้าง**: ขั้น 10 Mentoring, ขั้น 11 เครื่องมือสื่อสาร (สไลด์ วิดีโอ Email Pitch), อัปโหลดไฟล์ .docx, Prompt & Idea Intelligence, ReviewAppeal
- **Queue อยู่ในโปรเซสเดียวกับ API**: รีสตาร์ตแล้วงานที่ค้างถูกหยิบกลับเข้าคิว แต่ยังขยายเป็นหลายเครื่องไม่ได้ · ใช้ Redis + BullMQ ตอน deploy
- ข้อมูลเดโมทั้งหมด (คน ร้าน ชุมชน ตัวเลข) เป็นข้อมูลสมมติ

## วิธีรันซ้ำ

```bash
npm install
npm test                      # API test ทุก Gate (PGlite)
npm run test:gate1            # เฉพาะ Gate เดียว
npm run test:pg               # บน PostgreSQL จริง (ต้องมีเซิร์ฟเวอร์ที่ localhost:5432)
npm run typecheck
npm run build -w @ideax/web && npm run e2e   # E2E + ภาพหน้าจอลง docs/screenshots
```
