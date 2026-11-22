import { Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import CatalogView, { CatalogItem } from '@/components/CatalogView';

async function fetchAllItems(): Promise<CatalogItem[]> {
  const allItems: CatalogItem[] = [];
  const BATCH_SIZE = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select(
        `
        id,
        name_ja,
        name_en,
        category,
        source,
        item_variants (
          id,
          variant_name,
          colors,
          image_url
        )
      `
      )
      .order('name_ja', { ascending: true })
      .range(from, from + BATCH_SIZE - 1);

    if (error) {
      console.error('Supabase fetch error:', error);
      break;
    }

    if (!data || data.length === 0) break;

    allItems.push(...(data as CatalogItem[]));

    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return allItems;
}

async function CatalogContent() {
  const items = await fetchAllItems();
  const categories = Array.from(new Set(items.map((i) => i.category))).sort();

  return <CatalogView initialItems={items} categories={categories} />;
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f6f4ec] text-sm text-[#5c5349]">
          🍃 あつこれ帖を読み込み中...
        </div>
      }
    >
      <CatalogContent />
    </Suspense>
  );
}