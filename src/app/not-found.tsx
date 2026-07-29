import { IconSearch } from '@/components/icons';
import { LinkButton, StatusScreen } from '@/components/ui';

export default function NotFound() {
  return (
    <StatusScreen
      icon={<IconSearch className="size-12" />}
      title="找不到這個頁面"
      detail="網址可能打錯了，或這個連結已經失效。"
      action={<LinkButton href="/wallet">回到我的點數</LinkButton>}
    />
  );
}
