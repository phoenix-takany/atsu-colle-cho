'use client';

import { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export type ItemVariant = {
  id: string;
  variant_name: string;
  colors: string[];
  image_url: string | null;
};

export type CatalogItem = {
  id: string;
  name_ja: string;
  name_en: string;
  category: string;
  source: string[];
  item_variants: ItemVariant[];
};

const PAGE_SIZE = 60;

export default function CatalogView({
  initialItems,
  categories,
}: {
  initialItems: CatalogItem[];
  categories: string[];
}) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OWNED' | 'UNOWNED' | 'MULTI'>('ALL');  const [page, setPage] = useState(1);

  // 認証と所持データ（variant_id の Set）
  const [user, setUser] = useState<User | null>(null);
  const [ownedVariantIds, setOwnedVariantIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  // バリエーション管理モーダル用
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // ログインフォーム用
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const initialDisplayName =
    user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'ユーザー';

  const [displayName, setDisplayName] = useState('');
  const [currentUserName, setCurrentUserName] = useState(initialDisplayName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(initialDisplayName);
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState('');

  const handleUpdateDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) return;

    setSavingName(true);
    setNameMessage('');
    const { data, error } = await supabase.auth.updateUser({
        data: { display_name: trimmed },
    });
    setSavingName(false);

    if (error) {
        setNameMessage('変更に失敗しました');
        return;
    }

    const updatedName = data.user?.user_metadata?.display_name || trimmed;
    setCurrentUserName(updatedName);
    setIsEditingName(false);
    setNameMessage('');
    };
  
  const activeItem = useMemo(
    () => initialItems.find((item) => item.id === activeItemId) ?? null,
    [initialItems, activeItemId]
  );

  // 初回マウント時にログイン状態と所持データを取得
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // 追加：user が変わったら表示名を同期する
  useEffect(() => {
    const nextName =
      user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'ユーザー';
    setCurrentUserName(nextName);
    setDraftName(nextName);
    setIsEditingName(false);
  }, [user]);
  
  // ログインユーザーの所持一覧を取得
  useEffect(() => {
    if (!user) {
      setOwnedVariantIds(new Set());
      return;
    }

    const fetchOwned = async () => {
      const owned = new Set<string>();
      const BATCH = 1000;
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from('user_collections')
          .select('variant_id, status')
          .eq('user_id', user.id)
          .range(from, from + BATCH - 1);

        if (error) {
          console.error('所持データ取得エラー:', error);
          break;
        }
        if (!data || data.length === 0) break;
        data.forEach((row) => {
          if (row.status === 'owned' || row.status == null) {
            owned.add(row.variant_id);
          }
        });
        if (data.length < BATCH) break;
        from += BATCH;
      }

      setOwnedVariantIds(owned);
    };

    fetchOwned();
  }, [user]);

  // ログイン / 新規登録処理
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      setShowAuthModal(false);
      setEmail('');
      setPassword('');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : '認証に失敗しました');
    } finally {
      setAuthLoading(false);
    }
  };

  // 単一バリエーションの所持チェック切り替え
  const toggleOwned = async (variantId: string | undefined) => {
    if (!variantId) return;
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (savingIds.has(variantId)) return;

    const currentlyOwned = ownedVariantIds.has(variantId);
    const nextOwned = !currentlyOwned;

    setOwnedVariantIds((prev) => {
      const next = new Set(prev);
      if (nextOwned) next.add(variantId);
      else next.delete(variantId);
      return next;
    });
    setSavingIds((prev) => new Set(prev).add(variantId));

    try {
      if (nextOwned) {
        const { error } = await supabase.from('user_collections').upsert(
          {
            user_id: user.id,
            variant_id: variantId,
            status: 'owned',
            is_owned: true,
          },
          { onConflict: 'user_id,variant_id' }
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_collections')
          .delete()
          .eq('user_id', user.id)
          .eq('variant_id', variantId);
        if (error) throw error;
      }
    } catch (err) {
      console.error('保存エラー:', err);
      setOwnedVariantIds((prev) => {
        const revert = new Set(prev);
        if (currentlyOwned) revert.add(variantId);
        else revert.delete(variantId);
        return revert;
      });
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(variantId);
        return next;
      });
    }
  };

  // 複数バリエーションの一括セット（すべて所持 / すべて解除）
  const setAllVariantsOwned = async (variants: ItemVariant[], nextOwned: boolean) => {
    if (!user || variants.length === 0) return;

    const targetIds = variants
      .map((v) => v.id)
      .filter((id) => ownedVariantIds.has(id) !== nextOwned);
    if (targetIds.length === 0) return;

    const prevSet = new Set(ownedVariantIds);

    setOwnedVariantIds((prev) => {
      const next = new Set(prev);
      targetIds.forEach((id) => {
        if (nextOwned) next.add(id);
        else next.delete(id);
      });
      return next;
    });
    setSavingIds((prev) => {
      const next = new Set(prev);
      targetIds.forEach((id) => next.add(id));
      return next;
    });

    try {
      if (nextOwned) {
        const rows = targetIds.map((variantId) => ({
          user_id: user.id,
          variant_id: variantId,
          status: 'owned',
          is_owned: true,
        }));
        const { error } = await supabase
          .from('user_collections')
          .upsert(rows, { onConflict: 'user_id,variant_id' });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_collections')
          .delete()
          .eq('user_id', user.id)
          .in('variant_id', targetIds);
        if (error) throw error;
      }
    } catch (err) {
      console.error('一括保存エラー:', err);
      setOwnedVariantIds(prevSet);
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  // カードクリック時の挙動（複数バリエーションならモーダル、1つなら直接トグル）
  const handleCardClick = (item: CatalogItem) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (item.item_variants.length > 1) {
      setActiveItemId(item.id);
    } else {
      toggleOwned(item.item_variants?.[0]?.id);
    }
  };

  // 全体の所持数カウント
  const ownedItemCount = useMemo(() => {
    return initialItems.filter((item) =>
      item.item_variants.some((v) => ownedVariantIds.has(v.id))
    ).length;
  }, [initialItems, ownedVariantIds]);

  const completionRate =
    initialItems.length > 0
      ? ((ownedItemCount / initialItems.length) * 100).toFixed(1)
      : '0.0';

  // 選択中カテゴリの進捗計算
  const categoryStats = useMemo(() => {
    if (selectedCategory === 'ALL') return null;
    const catItems = initialItems.filter((item) => item.category === selectedCategory);
    const catOwned = catItems.filter((item) =>
      item.item_variants.some((v) => ownedVariantIds.has(v.id))
    ).length;
    const rate =
      catItems.length > 0 ? ((catOwned / catItems.length) * 100).toFixed(1) : '0.0';

    return {
      owned: catOwned,
      total: catItems.length,
      rate,
    };
  }, [initialItems, selectedCategory, ownedVariantIds]);

// 検索・カテゴリ・所持状態絞り込み
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialItems.filter((item) => {
      const matchCategory =
        selectedCategory === 'ALL' || item.category === selectedCategory;
      if (!matchCategory) return false;

      const isOwned = item.item_variants.some((v) => ownedVariantIds.has(v.id));
      if (statusFilter === 'OWNED' && !isOwned) return false;
      if (statusFilter === 'UNOWNED' && isOwned) return false;
      if (statusFilter === 'MULTI' && item.item_variants.length <= 1) return false;

      if (!q) return true;
      return (
        item.name_ja.toLowerCase().includes(q) ||
        item.name_en.toLowerCase().includes(q)
      );
    });
  }, [initialItems, search, selectedCategory, statusFilter, ownedVariantIds]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className="min-h-screen bg-[#f6f4ec] text-[#3d352e]">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b border-[#e2dccb] bg-[#fbf9f2]/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-[#2b6e53]">
                  🍃 あつこれ帖
                </h1>
                {user && (
                  <span className="rounded-full bg-[#e3f3eb] px-2.5 py-0.5 text-xs font-semibold text-[#2b6e53]">
                    所持: {ownedItemCount.toLocaleString()} / {initialItems.length.toLocaleString()} ({completionRate}%)
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#786e63]">
                表示中:{' '}
                <span className="font-semibold text-[#2b6e53]">
                  {filteredItems.length.toLocaleString()}
                </span>{' '}
                件
                {!user && '（ログインすると所持チェックを保存できます）'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* 検索ボックス */}
              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="アイテム名で検索..."
                  className="w-full rounded-full border border-[#d6cebc] bg-white px-4 py-1.5 text-sm shadow-xs outline-none transition focus:border-[#3fa37a] focus:ring-2 focus:ring-[#3fa37a]/20"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setPage(1);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8c8275] hover:text-[#3d352e]"
                  >
                    ✕
                  </button>
                )}
              </div>

{/* ログインボタン / ユーザー表示 */}
              {user ? (
                <div className="relative flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(currentUserName);
                      setNameMessage('');
                      setIsEditingName((prev) => !prev);
                    }}
                    title="クリックしてユーザー名を変更"
                    className="rounded-full border border-[#d6cebc] bg-[#f7f4ea] px-3.5 py-1.5 text-xs font-semibold text-[#2f2923] transition hover:bg-[#ebe5d5]"
                  >
                    {currentUserName} さん
                  </button>

                  {isEditingName && (
                    <form
                      onSubmit={handleUpdateDisplayName}
                      className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-[#d6cebc] bg-[#fbf9f2] p-3 shadow-lg"
                    >
                      <p className="mb-1.5 text-xs font-semibold text-[#2f2923]">
                        ユーザー名を設定・変更
                      </p>
                      <input
                        type="text"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        maxLength={20}
                        placeholder="表示したい名前を入力"
                        autoFocus
                        className="mb-2 w-full rounded-lg border border-[#d6cebc] bg-white px-2.5 py-1.5 text-xs text-[#2f2923] outline-none focus:border-[#3fa37a]"
                      />
                      {nameMessage && (
                        <p className="mb-2 text-[11px] text-red-600">{nameMessage}</p>
                      )}
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setIsEditingName(false)}
                          className="rounded-lg px-2.5 py-1 text-xs text-[#5c5349] hover:bg-[#ebe5d5]"
                        >
                          キャンセル
                        </button>
                        <button
                          type="submit"
                          disabled={savingName || !draftName.trim()}
                          className="rounded-lg bg-[#2b6e53] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#235a44] disabled:opacity-50"
                        >
                          {savingName ? '保存中...' : '保存'}
                        </button>
                      </div>
                    </form>
                  )}

                  <button
                    type="button"
                    onClick={() => supabase.auth.signOut()}
                    className="rounded-full border border-[#d6cebc] bg-white px-3.5 py-1.5 text-xs font-medium text-[#5c5349] transition hover:bg-[#f2efe6]"
                  >
                    ログアウト
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(false);
                    setAuthError('');
                    setShowAuthModal(true);
                  }}
                  className="rounded-full bg-[#2b6e53] px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#235a44]"
                >
                  ログイン / 登録
                </button>
              )}
            </div>
          </div>

          {/* 進捗バー（ログイン中に表示） */}
          {user && (
            <div className="mt-3 space-y-2 rounded-xl border border-[#e6e0cf] bg-white/80 p-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#3d352e]">全体コンプリート進捗</span>
                  <span className="font-semibold text-[#2b6e53]">
                    {ownedItemCount.toLocaleString()} / {initialItems.length.toLocaleString()} ({completionRate}%)
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#ebe5d5]">
                  <div
                    className="h-full rounded-full bg-[#3fa37a] transition-all duration-300"
                    style={{ width: `${Math.min(100, Number(completionRate))}%` }}
                  />
                </div>
              </div>

              {categoryStats && (
                <div className="border-t border-[#f0ece1] pt-2">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-[#5c5349]">
                      「{selectedCategory}」の進捗
                    </span>
                    <span className="font-semibold text-[#2b6e53]">
                      {categoryStats.owned.toLocaleString()} / {categoryStats.total.toLocaleString()} ({categoryStats.rate}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#ebe5d5]">
                    <div
                      className="h-full rounded-full bg-[#2b6e53] transition-all duration-300"
                      style={{ width: `${Math.min(100, Number(categoryStats.rate))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 所持フィルター + カテゴリタブ */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
<div className="flex rounded-full bg-[#ebe5d5] p-0.5 text-xs">
              {(
                [
                  { key: 'ALL', label: 'すべて' },
                  { key: 'OWNED', label: '所持済' },
                  { key: 'UNOWNED', label: '未所持' },
                  { key: 'MULTI', label: '複数カラバリ' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setStatusFilter(tab.key);
                    setPage(1);
                  }}
                  className={`rounded-full px-2.5 py-1 font-medium transition ${
                    statusFilter === tab.key
                      ? 'bg-white text-[#2b6e53] shadow-2xs'
                      : 'text-[#5c5349] hover:text-[#2f2923]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('ALL');
                  setPage(1);
                }}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                  selectedCategory === 'ALL'
                    ? 'bg-[#2b6e53] text-white shadow-xs'
                    : 'bg-[#ebe5d5] text-[#5c5349] hover:bg-[#dfd7c2]'
                }`}
              >
                全カテゴリ
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat);
                    setPage(1);
                  }}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                    selectedCategory === cat
                      ? 'bg-[#2b6e53] text-white shadow-xs'
                      : 'bg-[#ebe5d5] text-[#5c5349] hover:bg-[#dfd7c2]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {paginatedItems.length === 0 ? (
          <div className="rounded-2xl border border-[#e2dccb] bg-white p-12 text-center text-sm text-[#786e63]">
            条件に一致するアイテムが見つかりませんでした。
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {paginatedItems.map((item) => {
              const ownedVariantsCount = item.item_variants.filter((v) =>
                ownedVariantIds.has(v.id)
              ).length;
              const isOwned = ownedVariantsCount > 0;
              const hasMultipleVariants = item.item_variants.length > 1;

              // 所持中のバリエーションがあればその画像を優先表示
              const displayVariant =
                item.item_variants.find((v) => ownedVariantIds.has(v.id)) ??
                item.item_variants?.[0];
              const imageUrl = displayVariant?.image_url;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleCardClick(item)}
                  className={`group relative flex flex-col justify-between rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                    isOwned
                      ? 'border-[#3fa37a] bg-[#f0faf5] shadow-xs'
                      : 'border-[#e5dec9] bg-white shadow-2xs hover:border-[#7bc4a4]'
                  }`}
                >
                  {/* 所持バッジ */}
                  <span
                    className={`absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition ${
                      isOwned
                        ? 'bg-[#2b6e53] text-white shadow-xs'
                        : 'border border-[#d6cebc] bg-white/80 text-transparent group-hover:border-[#7bc4a4]'
                    }`}
                  >
                    ✓
                  </span>

                  <div className="w-full">
                    <div className="mb-2 flex aspect-square items-center justify-center rounded-xl bg-[#f7f5ee] p-2">
                      {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl}
                          alt={item.name_ja}
                          loading="lazy"
                          className="h-full w-full object-contain transition group-hover:scale-105"
                        />
                      ) : (
                        <span className="text-xs text-[#a3998c]">No Image</span>
                      )}
                    </div>

                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-[#2f2923]">
                      {item.name_ja}
                    </p>
                    {item.name_en !== item.name_ja && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-[#8c8275]">
                        {item.name_en}
                      </p>
                    )}
                  </div>

                  <div className="mt-2 flex w-full items-center justify-between gap-1 border-t border-[#f0ece1] pt-2">
                    <span className="truncate rounded-md bg-[#f2efe6] px-1.5 py-0.5 text-[10px] text-[#6b6156]">
                      {item.category}
                    </span>
                    {hasMultipleVariants && (
                      <span className="shrink-0 text-[10px] font-semibold text-[#2b6e53]">
                        {ownedVariantsCount}/{item.item_variants.length}種
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="rounded-full border border-[#d6cebc] bg-white px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              ← 前へ
            </button>
            <span className="text-xs font-medium text-[#5c5349]">
              {currentPage} / {totalPages} ページ
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="rounded-full border border-[#d6cebc] bg-white px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              次へ →
            </button>
          </div>
        )}
      </main>

      {/* バリエーション管理モーダル */}
      {activeItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setActiveItemId(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e2dccb] bg-[#fbf9f2] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div className="flex items-start justify-between border-b border-[#e6e0cf] bg-white px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-[#f2efe6] px-2 py-0.5 text-[11px] font-medium text-[#6b6156]">
                    {activeItem.category}
                  </span>
                  <span className="text-xs font-semibold text-[#2b6e53]">
                    所持{' '}
                    {
                      activeItem.item_variants.filter((v) =>
                        ownedVariantIds.has(v.id)
                      ).length
                    }{' '}
                    / {activeItem.item_variants.length} 種
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-bold text-[#2f2923]">
                  {activeItem.name_ja}
                </h2>
                {activeItem.name_en !== activeItem.name_ja && (
                  <p className="text-xs text-[#8c8275]">{activeItem.name_en}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setActiveItemId(null)}
                className="rounded-full p-1.5 text-sm text-[#8c8275] transition hover:bg-[#f2efe6] hover:text-[#3d352e]"
              >
                ✕
              </button>
            </div>

            {/* 一括操作バー */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ece6d7] bg-[#f7f5ee] px-5 py-2.5 text-xs">
              <span className="text-[#6b6156]">
                色・バリエーションをクリックして所持状態を切り替え
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllVariantsOwned(activeItem.item_variants, true)}
                  className="rounded-full bg-[#2b6e53] px-3 py-1 font-semibold text-white transition hover:bg-[#235a44]"
                >
                  すべて所持にする
                </button>
                <button
                  type="button"
                  onClick={() => setAllVariantsOwned(activeItem.item_variants, false)}
                  className="rounded-full border border-[#d6cebc] bg-white px-3 py-1 font-medium text-[#5c5349] transition hover:bg-[#ebe5d5]"
                >
                  すべて解除
                </button>
              </div>
            </div>

            {/* バリエーション一覧 */}
            <div className="grid grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3">
              {activeItem.item_variants.map((variant) => {
                const isVarOwned = ownedVariantIds.has(variant.id);
                const isSaving = savingIds.has(variant.id);

                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={isSaving}
                    onClick={() => toggleOwned(variant.id)}
                    className={`group relative flex flex-col justify-between rounded-2xl border p-3 text-left transition ${
                      isVarOwned
                        ? 'border-[#3fa37a] bg-[#f0faf5] shadow-xs'
                        : 'border-[#e5dec9] bg-white hover:border-[#7bc4a4]'
                    }`}
                  >
                    <span
                      className={`absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition ${
                        isVarOwned
                          ? 'bg-[#2b6e53] text-white'
                          : 'border border-[#d6cebc] bg-white text-transparent group-hover:border-[#7bc4a4]'
                      }`}
                    >
                      ✓
                    </span>

                    <div>
                      <div className="mb-2 flex aspect-square items-center justify-center rounded-xl bg-[#f7f5ee] p-2">
                        {variant.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={variant.image_url}
                            alt={variant.variant_name}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-[#a3998c]">No Image</span>
                        )}
                      </div>

                      <p className="text-xs font-semibold text-[#2f2923]">
                        {variant.variant_name}
                      </p>
                    </div>

                    {variant.colors && variant.colors.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {variant.colors.map((c) => (
                          <span
                            key={c}
                            className="rounded-md bg-[#f2efe6] px-1.5 py-0.5 text-[10px] text-[#6b6156]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ログイン・新規登録モーダル */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#e2dccb] bg-[#fbf9f2] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#2b6e53]">
                {isSignUp ? '新規アカウント登録' : 'あつこれ帖にログイン'}
              </h2>
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="text-sm text-[#8c8275] hover:text-[#3d352e]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#5c5349]">
                  メールアドレス
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1 w-full rounded-xl border border-[#d6cebc] bg-white px-3 py-2 text-sm outline-none focus:border-[#3fa37a]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5c5349]">
                  パスワード（6文字以上）
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  className="mt-1 w-full rounded-xl border border-[#d6cebc] bg-white px-3 py-2 text-sm outline-none focus:border-[#3fa37a]"
                />
              </div>

              {authError && (
                <p className="rounded-lg bg-red-50 p-2 text-xs text-red-600">
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full rounded-full bg-[#2b6e53] py-2 text-sm font-semibold text-white transition hover:bg-[#235a44] disabled:opacity-50"
              >
                {authLoading ? '処理中...' : isSignUp ? '登録する' : 'ログイン'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp((prev) => !prev);
                  setAuthError('');
                }}
                className="text-xs font-medium text-[#2b6e53] underline"
              >
                {isSignUp
                  ? 'すでにアカウントをお持ちの方（ログイン）'
                  : 'はじめての方はこちら（新規登録）'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}