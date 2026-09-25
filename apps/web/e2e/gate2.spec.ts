import { expect, test } from '@playwright/test';
import { QUIZ } from '../../api/src/modules/thaitern/curriculum';
import { CHAPTER_V4 } from '../../api/src/seed/ideax-data';
import { loginAs, shot } from './helpers';

const CANVAS: Record<string, string> = {
  problem: 'ต้นเหตุคือสาขาจามจุรีหมักโยเกิร์ตเท่ากันทุกวัน ทำให้ของเสียช่วงบ่ายสูงถึง 18% เพราะลูกค้าบ่ายน้อยและสั่งแก้ว S',
  target: 'นิสิตที่มาเป็นกลุ่มช่วงบ่าย 14:00–17:00 ซึ่งตอนนี้สั่งแก้ว S เป็นหลัก',
  unit_economics: 'ขายแก้วละ 65 บาท ต้นทุนผันแปร 26 บาท เหลือ 39 บาทต่อแก้ว ของเสีย 18% กินกำไรราว 8,000 บาทต่อเดือน',
  channels: 'ใช้เพจร้านประกาศโปรช่วงบ่าย และป้ายหน้าร้านจามจุรี',
  risks: 'ความเสี่ยงคือโปรทำให้กำไรต่อแก้วลด ถ้ายอดบ่ายไม่เพิ่ม 15% ภายใน 4 สัปดาห์ให้หยุด',
};

test.describe('Gate 2 · ผู้เรียน', () => {
  test('coursework: read the released result, precheck and resubmit with a receipt', async ({ page }) => {
    await loginAs(page, 'u_nicha');
    await expect(page.getByTestId('task')).toContainText('มีผลตรวจแล้ว');
    await shot(page, 'g2-today');
    await page.getByTestId('task').click();
    await page.getByRole('tab', { name: 'ผลตรวจ' }).click();
    await expect(page.getByText('ผลที่อาจารย์ยืนยัน')).toBeVisible();
    await expect(page.getByText('ส่งกลับให้แก้ · ไม่มีเกรด').first()).toBeVisible();
    await shot(page, 'g2-feedback');

    await page.getByRole('tab', { name: /ส่งฉบับใหม่/ }).click();
    await expect(page.getByTestId('submit')).toBeDisabled();
    await page.getByTestId('content').fill(CHAPTER_V4);
    await page.getByLabel('แก้อะไรไปบ้าง').fill('เพิ่มประโยค gap ท้าย §2.4 และแปลง Figure 2.1 เป็นตาราง');
    await page.getByRole('button', { name: 'ตรวจความพร้อม (ยังไม่ส่ง)' }).click();
    await expect(page.getByText('พบข้อความที่ตรงกับเกณฑ์ข้อ 1.3')).toBeVisible();
    await expect(page.getByText(/\d+\s?%/)).toHaveCount(0);
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('receipt')).toContainText('RCP-');
    await expect(page.getByTestId('receipt')).toContainText('ฉบับที่');
    await shot(page, 'g2-receipt');
  });

  test('coursework: understanding questions block pasting', async ({ page }) => {
    await loginAs(page, 'u_thanawat');
    await page.getByTestId('task').click();
    await page.getByRole('tab', { name: 'ตรวจความเข้าใจ' }).click();
    const box = page.getByTestId('verify-1');
    await expect(box).toBeVisible();
    await box.fill('');
    await box.focus();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'ข้อความที่คัดลอกมา');
      document.querySelector('[data-testid="verify-1"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(box).toHaveValue('');
    await box.fill('เพราะข้อมูลจากการสังเกต 8 สาขาชี้ว่าคู่มืออย่างเดียวไม่พอ ถ้าผู้จัดการอยู่นานขึ้นจะเลือกวิธีอื่น');
    await page.getByRole('button', { name: 'บันทึกคำตอบ' }).first().click();
    await expect(page.getByText('ตอบแล้ว').first()).toBeVisible();
  });

  test('THAItern journey: choose, first draft, learn, unlock, analyse, get challenged, submit', async ({ page }) => {
    await loginAs(page, 'u_joe');
    await page.getByRole('link', { name: 'หาโจทย์จริงจาก SME / ชุมชน' }).click();
    await expect(page.getByTestId('case-case_yogurt')).toBeVisible();
    await expect(page.getByTestId('case-case_yogurt')).not.toContainText('กำไรกลับลดลง'); // problem hidden until chosen
    await shot(page, 'g2-explore');
    await page.getByTestId('case-case_yogurt').getByRole('button', { name: 'เลือกช่วยที่นี่' }).click();
    await page.getByRole('button', { name: 'ยืนยันเลือก' }).click();
    await page.waitForURL('**/l/a/**');

    // 4a · first draft before learning
    await expect(page.getByText('กำไรกลับลดลง')).toBeVisible();
    await page.getByTestId('start-draft').click();
    await page.getByTestId('first-draft').fill('ร่างแรก: น่าจะเป็นเพราะวัตถุดิบแพงขึ้น ต้องดูต้นทุนก่อน');
    await shot(page, 'g2-first-draft');
    await page.getByTestId('draft-done').click();

    // 4 · sessions + quiz
    for (const key of ['sme-1', 'sme-2', 'sme-3', 'sme-4']) {
      await page.locator('.card', { hasText: key === 'sme-1' ? 'Case Thinking 101' : key === 'sme-2' ? 'Understanding the Business' : key === 'sme-3' ? 'Numbers that Matter' : 'Strategy & Pitch' }).locator('.between').first().click();
      await page.getByTestId(`complete-${key}`).click();
      await expect(page.getByTestId(`complete-${key}`)).toHaveCount(0);
    }
    for (const q of QUIZ.sme) await page.getByTestId(`q-${q.id}-${q.answer}`).check();
    await shot(page, 'g2-learning');
    await page.getByTestId('submit-quiz').click();

    // 5 · unlock with the access code
    const code = (await page.getByTestId('access-code').textContent())!.trim();
    await page.getByLabel('รหัสผ่าน').fill(code);
    await page.getByTestId('unlock').click();
    await expect(page.getByTestId('deadline')).toContainText('เหลือ 13 วัน');

    // 6 · booklet with watermark, stakeholder chat
    await expect(page.getByText('POS Data Room')).toBeVisible();
    await expect(page.locator('.watermark')).toHaveAttribute('data-wm', /โจ/);
    await shot(page, 'g2-booklet');
    await page.getByTestId('tab-6c').click();
    await page.getByRole('button', { name: /พี่ต้น/ }).click();
    await page.getByTestId('persona-input').fill('ทำไมของเสียช่วงบ่ายเยอะ');
    await page.getByRole('button', { name: 'ถาม', exact: true }).click();
    await expect(page.locator('.bubble.ai').last()).toContainText('หมักโยเกิร์ตทีเดียว');
    await shot(page, 'g2-chat');

    // 7 · canvas
    await page.getByTestId('tab-7').click();
    for (const [k, v] of Object.entries(CANVAS)) {
      await page.getByTestId(`canvas-${k}`).fill(v);
      await page.getByTestId(`save-${k}`).click();
    }
    await page.locator('.card', { hasText: 'Problem' }).getByRole('button', { name: 'ขอคำถามจาก AI Coach' }).click();
    await expect(page.locator('.evid').first()).toContainText('?');
    await shot(page, 'g2-canvas');

    // 8 · pushback
    await page.getByTestId('tab-8').click();
    await page.getByTestId('start-pushback').click();
    await expect(page.getByText('Senior Consultant:')).toBeVisible();
    await page.getByTestId('defense').fill('ข้อมูลใน Data Room แสดงว่าของเสียจามจุรีเพิ่มจาก 11% เป็น 18% ขณะที่บรรทัดทองคงที่ 4–5% ต้นเหตุจึงอยู่ที่การหมักรอบเดียว ไม่ใช่ราคา');
    await page.getByTestId('send-defense').click();
    await expect(page.getByText('ผ่านแล้ว')).toBeVisible();
    await shot(page, 'g2-pushback');

    // 9 · simulator
    await page.getByTestId('tab-9').click();
    await page.getByLabel(/ราคาต่อแก้ว/).fill('69');
    await page.getByTestId('simulate').click();
    await expect(page.getByText('จุดคุ้มทุน')).toBeVisible();
    await shot(page, 'g2-simulator');

    // 12 · precheck and submit
    await page.getByTestId('tab-12').click();
    await page.getByTestId('answer-q1').fill('ต้นเหตุคือการหมักรอบเดียวที่สาขาจามจุรี ข้อมูลของเสียเพิ่มจาก 11% เป็น 18% ขณะที่บรรทัดทองคงที่ ทำให้กำไรลดแม้ยอดขายรวมเพิ่ม');
    await page.getByTestId('answer-q2').fill('ทางเลือกคือหมักสองรอบที่จามจุรีแทนการลดราคา เปรียบเทียบแล้วความเสี่ยงต่ำกว่า วัดผลด้วยของเสียต่ำกว่า 8% และกำไรเดือนละ 8,000 บาท');
    await page.getByTestId('summary').fill('สรุป: หมักสองรอบที่จามจุรี ลดของเสียจาก 18% เหลือต่ำกว่า 8% กำไรกลับมาเดือนละ 8,000 บาท');
    await page.getByTestId('precheck').click();
    await expect(page.getByText('ผ่านการท้าทายจาก Senior Consultant แล้ว')).toBeVisible();
    await page.getByTestId('final-submit').click();
    await expect(page.getByTestId('t-receipt')).toContainText('TXR-');
    await shot(page, 'g2-t-receipt');
  });

  test('the learner home and stages look right on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'u_joe');
    await expect(page.getByTestId('stage-1')).toBeVisible();
    await shot(page, 'g2-today-mobile');
  });
});
