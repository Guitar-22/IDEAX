import { useDemoRouter } from './router';
export function useRouter() {
  return useDemoRouter();
}
export function usePathname() {
  return useDemoRouter().path;
}
