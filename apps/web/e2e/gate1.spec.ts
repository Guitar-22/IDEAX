import { expect, test } from '@playwright/test';
import { apiAs, expectToast, loginAs, shot } from './helpers';

test.describe('Gate 1 · อาจารย์', () => {
  test('review with AI proposals, human decisions, conflict handling and release', async ({ page }) => {
    await loginAs(page, 'u_teacher');
    await expect(page.getByTestId('queue-item')).toHaveCount(2);
    await shot(page, 'g1-queue');

    await page.getByTestId('queue-item').filter({ hasText: 'ณิชา' }).click();
    const item = (no: string) => page.getByTestId(`item-${no}`);
    await expect(item('1.1')).toBeVisible();
    await expect(page.locator('.span').first()).toBeVisible();
    await shot(page, 'g1-review');

    // accept a proposal
    await item('1.1').getByRole('button', { name: /^ยืนยัน/ }).click();
    await expect(item('1.1')).toContainText('อาจารย์ยืนยันแล้ว');

    // a different grade needs a reason
    await item('1.2').getByRole('button', { name: 'เปลี่ยนเกรด' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: 'B', exact: true }).click();
    await expect(dlg.getByRole('button', { name: 'บันทึกเป็นผลของอาจารย์' })).toBeDisabled();
    await dlg.getByRole('textbox').fill('แยกกลุ่มได้ แต่ยังไม่เล่าว่าแต่ละกลุ่มรู้อะไร');
    await shot(page, 'g1-grade-modal');
    await dlg.getByRole('button', { name: 'บันทึกเป็นผลของอาจารย์' }).click();
    await expect(item('1.2')).toContainText('อาจารย์ยืนยันแล้ว');

    // return for revision: no grade
    await item('1.3').getByRole('button', { name: 'ส่งกลับให้แก้' }).click();
    await page.getByRole('dialog').getByLabel(/^J/).check();
    await page.getByRole('dialog').getByRole('textbox').fill('เพิ่มประโยค gap ท้าย §2.4');
    await page.getByRole('dialog').getByRole('button', { name: 'ส่งกลับให้แก้' }).click();
    await expect(item('1.3')).toContainText('ส่งกลับให้แก้');

    // AC-11: the marker saves 1.4 first; the teacher's stale click shows the conflict dialog
    const svid = page.url().split('/').pop()!;
    const m = await apiAs(page, 'u_marker', 'POST', `/v1/reviews/${svid}/items/1.4/decision`, { action: 'accept', rowVersion: 1 });
    expect(m.status).toBe(200);
    await item('1.4').getByRole('button', { name: /^ยืนยัน/ }).click();
    await expect(page.getByRole('dialog')).toContainText('มีคนแก้ผลชิ้นนี้พร้อมกับคุณ');
    await expect(page.getByRole('dialog')).toContainText('อ.ดร. ธนกฤต แสงมณี');
    await shot(page, 'g1-conflict');
    await page.getByRole('button', { name: 'โหลดฉบับล่าสุด' }).click();
    await expect(item('1.4')).toContainText('อ.ดร. ธนกฤต แสงมณี');

    // bulk-accept the rest criterion by criterion
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: /ยืนยันที่ระบบเสนอทั้งเกณฑ์/ }).first().click();
      await expectToast(page, /บันทึกเป็นการตัดสินใจครั้งเดียว/);
    }
    // the three grey items need a human
    for (const [cri, no] of [
      ['Conceptualisation', '2.4'],
      ['Chapter Structure', '3.2'],
      ['Academic Referencing', '4.4'],
    ]) {
      await page.locator('.crigrp-h', { hasText: cri }).click();
      await item(no).getByRole('button', { name: 'ส่งกลับให้แก้' }).click();
      await page.getByRole('dialog').getByLabel(/^D/).check();
      await page.getByRole('dialog').getByRole('button', { name: 'ส่งกลับให้แก้' }).click();
      await expect(item(no)).toContainText('ส่งกลับให้แก้');
    }

    await page.getByRole('link', { name: /ส่ง Feedback \(16\/16\)/ }).click();
    await expect(page.getByText('ผลที่อาจารย์ยืนยัน')).toBeVisible();
    await page.getByLabel('ข้อความถึงผู้เรียน (ไม่บังคับ)').fill('แก้ข้อ 1.3 และแปลง Figure 2.1 เป็นตาราง แล้วส่งใหม่');
    await shot(page, 'g1-release');
    await page.getByRole('button', { name: 'ปล่อยผล · ให้แก้และส่งใหม่' }).click();
    await page.waitForURL('**/t');
    await expect(page.getByTestId('queue-item').filter({ hasText: 'ณิชา' })).toContainText('ปล่อยผลแล้ว');
  });

  test('course page groups learners by evidence', async ({ page }) => {
    await loginAs(page, 'u_teacher');
    await page.getByRole('link', { name: 'รายวิชาและกลุ่มผู้เรียน' }).click();
    await expect(page.getByTestId('group-needs_feedback')).toContainText('ณิชา');
    await expect(page.getByTestId('group-insufficient')).toContainText('ธนวัฒน์');
    await shot(page, 'g1-course');
  });

  test('the review screen works on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'u_teacher');
    await page.getByTestId('queue-item').filter({ hasText: 'ธนวัฒน์' }).click();
    await expect(page.getByRole('button', { name: 'เกณฑ์', exact: true })).toBeVisible();
    await expect(page.getByTestId('item-1.1')).toBeVisible();
    await shot(page, 'g1-review-mobile');
  });
});
