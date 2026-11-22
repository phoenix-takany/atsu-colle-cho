import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  console.error('❌ .env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SECRET_KEY が設定されているか確認してください。');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false },
});

const DATA_URL = 'https://raw.githubusercontent.com/Norviah/animal-crossing/master/json/combined/Items.json';

function normalizeItem(raw, index) {
  const nameEn = raw.name ?? `item-${index}`;
  const nameJa =
    raw.translations?.jPja ??
    raw.translations?.['ja-JP'] ??
    raw.translations?.['JAjp'] ??
    nameEn;

  const category = String(raw.sourceSheet ?? raw.category ?? 'Uncategorized');
  const internalId = String(
    raw.uniqueEntryId ?? `${category}_${nameEn}_${index}`
  );

  const rawSource = raw.variants?.[0]?.source ?? raw.source;
  const source = Array.isArray(rawSource)
    ? rawSource.map(String)
    : rawSource
      ? [String(rawSource)]
      : [];

  const rawVariants =
    Array.isArray(raw.variants) && raw.variants.length > 0
      ? raw.variants
      : [
          {
            variant: 'default',
            colors: raw.colors ?? [],
            image: raw.image ?? null,
          },
        ];

const seenVariantNames = new Set();
  const variants = rawVariants.map((v, vIndex) => {
    const baseName = [v.variation, v.pattern].filter(Boolean).join(' / ') || v.variant || 'default';
    let variantName = String(baseName);
    if (seenVariantNames.has(variantName)) {
      variantName = `${variantName} (${vIndex + 1})`;
    }
    seenVariantNames.add(variantName);

    // 考えられるすべての画像フィールドからURLを探す
    const imageUrl =
      v.image ??
      v.storageImage ??
      v.inventoryImage ??
      v.framedImage ??
      v.albumImage ??
      raw.image ??
      raw.storageImage ??
      raw.inventoryImage ??
      raw.framedImage ??
      raw.albumImage ??
      raw.iconImage ??
      null;

    return {
      variant_name: variantName,
      colors: Array.isArray(v.colors) ? v.colors.map(String) : [],
      image_url: imageUrl,
      sort_order: vIndex,
    };
  });
  return {
    item: {
      internal_id: internalId,
      name_ja: String(nameJa),
      name_en: String(nameEn),
      category,
      source,
    },
    variants,
  };
}

async function seed() {
  console.log('🌐 GitHubからあつ森アイテムJSONをダウンロード中...');
  const res = await fetch(DATA_URL);
  if (!res.ok) {
    throw new Error(`JSONの取得に失敗しました: ${res.status} ${res.statusText}`);
  }
  const rawList = await res.json();
  console.log(`📦 全 ${rawList.length} 件のデータを整形しています...`);

  const normalizedMap = new Map();
  rawList.forEach((raw, idx) => {
    const entry = normalizeItem(raw, idx);
    if (!normalizedMap.has(entry.item.internal_id)) {
      normalizedMap.set(entry.item.internal_id, entry);
    }
  });
  const normalizedList = Array.from(normalizedMap.values());

  const CHUNK_SIZE = 500;
  const itemsPayload = normalizedList.map((entry) => entry.item);
  const itemIdMap = new Map();

  console.log(`⬆️ items テーブルへ登録中（全 ${itemsPayload.length} 件）...`);
  for (let i = 0; i < itemsPayload.length; i += CHUNK_SIZE) {
    const chunk = itemsPayload.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from('items')
      .upsert(chunk, { onConflict: 'internal_id' })
      .select('id, internal_id');

    if (error) {
      throw new Error(`items の登録エラー: ${error.message}`);
    }
    for (const row of data) {
      itemIdMap.set(row.internal_id, row.id);
    }
  }

  const variantsPayload = [];
  for (const entry of normalizedList) {
    const parentId = itemIdMap.get(entry.item.internal_id);
    if (!parentId) continue;

    for (const v of entry.variants) {
      variantsPayload.push({
        item_id: parentId,
        variant_name: v.variant_name,
        colors: v.colors,
        image_url: v.image_url,
        sort_order: v.sort_order,
      });
    }
  }

  console.log(`⬆️ item_variants テーブルへ登録中（全 ${variantsPayload.length} 件）...`);
  for (let i = 0; i < variantsPayload.length; i += CHUNK_SIZE) {
    const chunk = variantsPayload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from('item_variants')
      .upsert(chunk, { onConflict: 'item_id,variant_name' });

    if (error) {
      throw new Error(`item_variants の登録エラー: ${error.message}`);
    }
  }

  console.log(`✅ 完了！items: ${itemIdMap.size}件 / item_variants: ${variantsPayload.length}件 を登録しました！`);
}

seed().catch((err) => {
  console.error('❌ エラーが発生しました:', err);
  process.exit(1);
});