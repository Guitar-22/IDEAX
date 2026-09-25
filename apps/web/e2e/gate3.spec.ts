import { expect, test } from '@playwright/test';
import { apiAs, expectToast, loginAs, shot } from './helpers';

test.describe('Gate 3 · SME / องค์กร', () => {
  test('judge confirms and releases; the learner answers the understanding check and gets a certificate', async ({ page }) => {
    await loginAs(page, 'u_judge');
    await page.getByRole('link', { name: /นมเย็นดี.*2 สาขา/ }).click();
    await page.getByTestId('open-sub').first().click();
    await expect(page.getByRole('dialog')).toContainText('ยืนยันระดับรายเกณฑ์');
    await page.getByTestId('feedback').fill('ใช้ข้อมูลของเสียแยกสาขาได้ดีมาก ข้อเสนอหมักสองรอบทำได้จริงและวัดผลได้');
    await shot(page, 'g3-judge');
    await page.getByTestId('save-eval').click();
    await expectToast(page, 'บันทึกแล้ว');
    await page.getByTestId('release-case').click();
    await expectToast(page, /ปล่อยผลแล้ว/);

    await loginAs(page, 'u_joe');
    await page.getByTestId('attempt').click();
    await expect(page.getByText('Feedback จากกรรมการและเจ้าของโจทย์')).toBeVisible();
    const boxes = page.locator('[data-testid^="tverify-"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      await page.locator('[data-testid^="tverify-"]').first().fill('เพราะข้อมูลของเสียเพิ่มเฉพาะที่จามจุรี ถ้าบรรทัดทองมีของเสียเพิ่มด้วย ผมจะกลับไปดูเรื่องวัตถุดิบแทน');
      await page.getByRole('button', { name: 'บันทึกคำตอบ' }).first().click();
      await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('certificate')).toContainText('ใบรับรองระดับ');
    await shot(page, 'g2-certificate');
    await page.getByRole('link', { name: 'ลิงก์ตรวจสอบสาธารณะ' }).click();
    await expect(page.getByText('ใบรับรองนี้มีอยู่จริงในระบบ')).toBeVisible();
  });

  test('publish → organisation finds it → contact after consent and payment', async ({ page }) => {
    await loginAs(page, 'u_nicha');
    await page.getByRole('link', { name: 'ผลงาน' }).click();
    await page.getByRole('button', { name: 'สร้างการ์ดผลงาน' }).click();
    await page.getByTestId('pub-title').fill('Digital capability ของผู้สืบทอดรุ่นสองในธุรกิจครอบครัวไทย');
    await page.getByTestId('pub-problem').fill('ธุรกิจครอบครัวไทยสะดุดตอนส่งต่อรุ่นสอง เพราะระบบอยู่ในความจำผู้ก่อตั้ง');
    await page.getByTestId('pub-approach').fill('ทบทวนวรรณกรรมสามสาย และติดตามผู้สืบทอด 12 รายหนึ่งปีการศึกษา');
    await page.getByTestId('pub-create').click();
    await expect(page.getByRole('dialog')).toContainText('ตัวอย่างฉบับที่องค์กรจะเห็น');
    await expect(page.getByRole('dialog')).toContainText('ผศ.ดร. กมลชนก วีรกุล ตรวจตามเกณฑ์');
    await shot(page, 'g3-publish-preview');
    await page.getByTestId('pub-publish').click();
    await expect(page.getByTestId('pub')).toContainText('PUBLISHED');

    await loginAs(page, 'u_org');
    await page.getByTestId('search').fill('ผู้สืบทอด');
    await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
    await expect(page.getByTestId('pub-card')).toHaveCount(1);
    await expect(page.getByTestId('pub-card')).not.toContainText('B+');
    await shot(page, 'g3-search');
    await page.getByRole('link', { name: 'ดูรายละเอียด' }).click();
    await page.getByTestId('contact').click();
    await page.getByTestId('purpose').fill('ขอเป็นกรณีศึกษาของงานวิจัย และขอคำปรึกษาเรื่องการส่งต่อระบบจากรุ่นก่อน');
    await page.getByTestId('scope').fill('เกณฑ์คัดเลือกกรณีศึกษา');
    await page.getByTestId('send-contact').click();
    await expectToast(page, 'ส่งคำขอแล้ว');
    await page.getByRole('link', { name: 'คำขอของเรา' }).click();
    await expect(page.getByTestId('org-contact')).toContainText('ยังไม่เห็นข้อมูลติดต่อ');

    await loginAs(page, 'u_nicha');
    await page.getByRole('link', { name: 'คำขอติดต่อ' }).click();
    await shot(page, 'g3-owner-request');
    await page.getByTestId('accept-contact').click();
    await expectToast(page, 'ACCEPTED');

    await loginAs(page, 'u_org');
    await page.getByRole('link', { name: 'คำขอของเรา' }).click();
    await expect(page.getByTestId('org-contact')).toContainText('ยังไม่เห็นข้อมูลติดต่อ');
    await page.getByTestId('pay-contact').click();
    await expect(page.getByTestId('org-contact')).toContainText('nicha@demo.ideax');
    await shot(page, 'g3-contact-unlocked');
  });

  test('case production: licence → anonymise → draft → expert → owner → published', async ({ page }) => {
    await loginAs(page, 'u_ops');
    await page.getByRole('button', { name: 'เปิดเคสใหม่' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('องค์กรเจ้าของโจทย์ (id)').fill('org_hostel');
    await dlg.getByLabel('กลุ่ม SME').selectOption('nonfood_services');
    await dlg.getByLabel('หมวดย่อย').fill('Tourism & Hospitality');
    await dlg.getByLabel(/อุตสาหกรรม/).fill('hospitality_tours');
    await dlg.getByLabel('ชื่อเคส').fill('ทัวร์เดินเท้าริมคลอง');
    await dlg.getByLabel(/Teaser/).fill('โฮสเทลอยากเพิ่มทัวร์เดินเท้า (ตัวอย่างสมมติ)');
    await dlg.getByLabel(/โจทย์ย่อ/).fill('อยากรู้ว่าทัวร์ควรตั้งราคาเท่าไร');
    await dlg.getByLabel(/Stage/).fill('1,5,6');
    await dlg.getByRole('button', { name: 'เปิดเคส' }).click();
    await page.waitForURL('**/p/c/**');
    const caseId = page.url().split('/').pop()!;

    await loginAs(page, 'u_owner2');
    await page.goto(`/p/c/${caseId}`);
    await page.getByTestId('sign').click();
    await expect(page.getByText('ลงนามแล้ว')).toBeVisible();
    for (const asset of [
      { kind: 'brief', name: 'ภาพรวม', content: 'โฮสเทล 24 เตียง ติดต่อคุณเอกที่ 081-555-1234' },
      { kind: 'finance', name: 'ตัวเลข', content: JSON.stringify({ unit: 'ที่นั่ง', basePrice: 450, baseUnitsPerMonth: 120, unitCost: 120, fixedCostPerMonth: 20000, wagePerStaff: 9000, unitsPerStaff: 100, priceElasticity: -1, marketingLift: 0.3, baseHeadcount: 2, baseMarketing: 1000 }) },
      { kind: 'question', name: 'คำถาม', content: 'ทัวร์ควรตั้งราคาเท่าไร' },
    ]) {
      expect((await apiAs(page, 'u_owner2', 'POST', `/v1/partner/cases/${caseId}/assets`, asset)).status).toBe(201);
    }

    await loginAs(page, 'u_ops');
    await page.goto(`/p/c/${caseId}`);
    await page.getByRole('button', { name: 'ปกปิดตัวตน' }).click();
    await expectToast(page, 'ANONYMIZING');
    await expect(page.getByText('[เบอร์โทร]')).toBeVisible();
    await page.getByRole('button', { name: 'สร้างร่าง' }).click();
    await expectToast(page, 'EXPERT_REVIEW');

    await loginAs(page, 'u_reviewer');
    await page.goto(`/p/c/${caseId}`);
    await page.getByLabel('ความเห็น (บังคับ)').fill('สมจริง ชัดเจน ใช้ได้');
    await page.getByTestId('expert-approve').click();
    await expectToast(page, 'OWNER_APPROVAL');

    await loginAs(page, 'u_owner2');
    await page.goto(`/p/c/${caseId}`);
    await expect(page.getByText('ตรวจโดย ดร. วรเมธ')).toBeVisible();
    await page.getByTestId('owner-approve').click();
    await expectToast(page, 'PUBLISHED');
    await shot(page, 'g3-case-published');
  });

  test('the SME owner reads only screened-in works, with a weekly quota', async ({ page }) => {
    await loginAs(page, 'u_owner');
    await page.getByRole('link', { name: /นมเย็นดี.*2 สาขา/ }).click();
    await page.getByTestId('tab-eval').click();
    await expect(page.getByText(/อ่านได้สัปดาห์ละ 3 ผลงาน/)).toBeVisible();
    await shot(page, 'g3-owner-shortlist');
  });
});
