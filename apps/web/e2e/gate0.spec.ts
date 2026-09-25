import { expect, test } from '@playwright/test';
import { shot } from './helpers';

test.describe('Gate 0 · ฐานระบบร่วม', () => {
  test('home shows the three gates and the colour rule', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'หนึ่งเครื่องยนต์ สองประตู' })).toBeVisible();
    for (const g of ['Gate 1 · อาจารย์', 'Gate 2 · ผู้เรียน', 'Gate 3 · SME / องค์กร']) await expect(page.getByText(g)).toBeVisible();
    await expect(page.getByText('ฟ้า = AI เสนอ')).toBeVisible();
    await shot(page, 'g0-home');
  });

  test('adult signup needs the three mandatory consents', async ({ page }) => {
    await page.goto('/signup');
    const submit = page.getByRole('button', { name: 'สมัครและเริ่มต้น' });
    await page.getByLabel('ชื่อ-นามสกุล').fill('มานี ทดสอบ');
    await page.getByLabel('อีเมล').fill('manee@test.th');
    await page.getByLabel('ปีเกิด (ค.ศ.)').fill('2003');
    await page.getByLabel('เบอร์มือถือ (ยืนยันด้วย OTP)').fill('0812345678');
    await page.getByLabel('สถานศึกษา').fill('มหาวิทยาลัยราชภัฏตัวอย่าง');
    await page.getByLabel('จังหวัด').fill('อุดรธานี');
    await expect(submit).toBeDisabled();
    const boxes = page.locator('.check input[type=checkbox]');
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    await expect(submit).toBeEnabled();
    await shot(page, 'g0-signup');
    await submit.click();
    await page.waitForURL('**/s');
    await expect(page.getByRole('heading', { name: 'วันนี้' })).toBeVisible();
    await expect(page.getByText('ยังไม่ได้ยืนยันบัตรนักศึกษา')).toBeVisible();
  });

  test('a minor signs up and the guardian confirms with OTP', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('ชื่อ-นามสกุล').fill('น้องเมย์');
    await page.getByLabel('อีเมล').fill('may@test.th');
    await page.getByLabel('ปีเกิด (ค.ศ.)').fill('2010');
    await page.getByLabel('เบอร์มือถือ (ยืนยันด้วย OTP)').fill('0812345679');
    await page.getByLabel('สถานศึกษา').fill('โรงเรียนตัวอย่าง');
    await page.getByLabel('จังหวัด').fill('น่าน');
    await page.getByLabel('เบอร์ผู้ปกครอง').fill('0899990000');
    const boxes = page.locator('.check input[type=checkbox]');
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    await page.getByRole('button', { name: 'สมัครและเริ่มต้น' }).click();
    await expect(page.getByRole('heading', { name: 'รอความยินยอมจากผู้ปกครอง' })).toBeVisible();
    const otp = await page.getByTestId('dev-otp').textContent();
    await page.getByLabel('รหัส OTP 6 หลักที่ผู้ปกครองได้รับ').fill(otp!.trim());
    await page.getByRole('button', { name: 'ยืนยันความยินยอม' }).click();
    await page.waitForURL('**/s');
    await expect(page.getByText('รอความยินยอมจากผู้ปกครอง')).toHaveCount(0);
  });

  test('audit drawer lists transitions with correlation ids', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('persona-u_teacher').click();
    await page.waitForURL('**/t');
    await page.getByRole('button', { name: 'บันทึกระบบ' }).click();
    await expect(page.getByLabel('บันทึกระบบ')).toContainText('cid-');
  });
});
