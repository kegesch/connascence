import { openTab, closeTab } from './tabs';

export function demo(): void {
  openTab('home');
  closeTab('home');
  openTab('home');
  closeTab('home');
  openTab('home');
  openTab('settings');
  closeTab('settings');
  openTab('profile');
  closeTab('profile');
}
