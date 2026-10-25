// card render helpers — extracted (Phase 3)

 if (res.status === 403 || res.status === 401) {
 toast.error('ليس لديك صلاحية الوصول');
 return;
 }
 setBackendOnline(false);
 toast.error(data.error || 'فشل في جلب الكروت');
 return;
 }

 setBackendOnline(true);
 const list = data.items || data.cards || (Array.isArray(data.data) ? data.data : []);
 setCards(Array.isArray(list) ? list : []);

 if (data.stats) {
 setStats({
 total: data.stats.total ?? list.length,
 published:
 data.stats.published ??
 list.filter((c) => normalizeStatus(c.status) === 'published').length,
 lessonsCount: data.stats.lessons ?? 0,
 lastGeneratedAt: data.stats.last_generated_at,
 });
 } else {
 // Compute stats from the list as a fallback
 const publishedCount = list.filter(
 (c) => normalizeStatus(c.status) === 'published'
 ).length;
 const lastGenerated = list.find(
 (c) =>
 normalizeStatus(c.status) === 'generated' ||
 normalizeStatus(c.status) === 'published'
 );
 setStats({
 total: list.length,
 published: publishedCount,
 lessonsCount: stats.lessonsCount,
 lastGeneratedAt: lastGenerated?.generated_at || lastGenerated?.created_at,
 });
 }
 } catch (err) {
 // Connection error (network failure) = الباك اند فعلاً مش متاح
 setBackendOnline(false);
 console.error('[admin/educational-cards] fetchCards error:', err);
 toast.error('تعذّر تحميل الكروت التعليمية');
 } finally {
 if (mode === 'initial') {
 setLoading(false);
 } else {
 setRefreshing(false);
 }
 }
 },
 [categoryFilter, stats.lessonsCount]
 );

 // Initial load - fetch both lessons and cards
 useEffect(() => {
 fetchCards('initial');
 fetchLessons();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // Refetch when category filter changes
 useEffect(() => {
 if (!loading) {
 fetchCards('refresh');
 fetchLessons();
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [categoryFilter]);

 // --------------------------------------------------------------------------
 // Selected lesson preview
 // --------------------------------------------------------------------------
 const selectedLesson = useMemo(() => {
 if (!selectedLessonId) return null;
 return lessons.find((l) => l.id === selectedLessonId) || null;
 }, [lessons, selectedLessonId]);

 // --------------------------------------------------------------------------
 // Generate cards
 // --------------------------------------------------------------------------
 // === Handlers للميزات الجديدة ===
 const [generatingExtra, setGeneratingExtra] = useState(false);

 const handleGenerateInfographic = async () => {
 if (!selectedLessonId) {
 toast.error('اختر درساً أولاً');
 return;
 }
 setGeneratingExtra(true);
 const toastId = toast.loading('جاري توليد الإنفوجرافيك...');
 try {
 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ lesson_id: selectedLessonId, action: 'infographic' }),
 });
 const data = await res.json();
 if (data.success) {
 const info = data.data?.data || data.data;
 toast.success('تم توليد الإنفوجرافيك ✓', { id: toastId });
 if (info?.infographic_url) {
 window.open(info.infographic_url, '_blank');
 }
 } else {
 toast.error(data.error || 'فشل في توليد الإنفوجرافيك', { id: toastId });
 }
 } catch {
 toast.error('خطأ في الاتصال', { id: toastId });
 }
 setGeneratingExtra(false);
 };

 const handleGeneratePDF = async () => {
 if (!selectedLessonId) {
 toast.error('اختر درساً أولاً');
 return;
 }
 setGeneratingExtra(true);
 const toastId = toast.loading('جاري توليد PDF...');
 try {
 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ lesson_id: selectedLessonId, action: 'pdf' }),
 });
 const data = await res.json();
 if (data.success) {
 const pdf = data.data?.data || data.data;
 toast.success('تم توليد PDF ✓', { id: toastId });
 if (pdf?.pdf_url) {
 window.open(pdf.pdf_url, '_blank');
 }
 } else {
 toast.error(data.error || 'فشل في توليد PDF', { id: toastId });
 }
 } catch {
 toast.error('خطأ في الاتصال', { id: toastId });
 }
 setGeneratingExtra(false);
 };

 const handleGenerateGIF = async () => {
 if (!selectedLessonId) {
 toast.error('اختر درساً أولاً');
 return;
 }
 setGeneratingExtra(true);
 const toastId = toast.loading('جاري توليد GIF متحرك...');
 try {
 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ lesson_id: selectedLessonId, action: 'gif' }),
 });
 const data = await res.json();
 if (data.success) {
 const gif = data.data?.data || data.data;
 toast.success('تم توليد GIF ✓', { id: toastId });
 if (gif?.gif_url) {
 window.open(gif.gif_url, '_blank');
 }
 } else {
 toast.error(data.error || 'فشل في توليد GIF', { id: toastId });
 }
 } catch {
 toast.error('خطأ في الاتصال', { id: toastId });
 }
 setGeneratingExtra(false);
 };

 const handleGenerate = async () => {
 if (!selectedLessonId) {
 toast.error('من فضلك اختر درساً أولاً');
 return;
 }

 setGenerating(true);
 const toastId = toast.loading('جاري توليد الكروت التعليمية...');

 try {
 const body: Record<string, unknown> = {
 lesson_id: selectedLessonId,
 style: cardStyle,
 num_cards: numCards,
 generate_video: generateVideo,
 };

 if (generateVideo) {
 body.video_duration = videoDuration;
 }

 const res = await adminFetch('/api/admin/educational-cards', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 const data: GenerateResponse = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل في توليد الكروت', { id: toastId });
 return;
 }

 const message =
 data.message ||
 (Array.isArray(data.cards) && data.cards.length > 0
 ? `تم توليد ${data.cards.length} كارت بنجاح`
 : 'تم توليد الكروت بنجاح');
 toast.success(message, { id: toastId });

 // Refresh the list
 await fetchCards('refresh');
 } catch (err) {
 console.error('[admin/educational-cards] generate error:', err);
 toast.error('خطأ في توليد الكروت', { id: toastId });
 } finally {
 setGenerating(false);
 }
 };

 // --------------------------------------------------------------------------
 // View single card (open modal)
 // --------------------------------------------------------------------------
 const handleView = async (cardId: string) => {
 setPreviewOpen(true);
 setPreviewLoading(true);
 setPreviewCard(null);
 try {
 const res = await adminFetch(
 `/api/admin/educational-cards/${encodeURIComponent(cardId)}`,
 { cache: 'no-store' }
 );
 const data: SingleResponse = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل في جلب الكارت');
 setPreviewOpen(false);
 return;
 }

 const card = data.card || data.data || null;
 setPreviewCard(card);
 } catch (err) {
 console.error('[admin/educational-cards] view error:', err);
 toast.error('خطأ في جلب الكارت');
 setPreviewOpen(false);
 } finally {
 setPreviewLoading(false);
 }
 };

 // --------------------------------------------------------------------------
 // Publish to Telegram
 // --------------------------------------------------------------------------
 const handlePublish = async (cardId: string) => {
 setPublishingIds((prev) => new Set(prev).add(cardId));
 const toastId = toast.loading('جاري النشر على تليجرام...');
 try {
 const res = await adminFetch(
 `/api/admin/educational-cards/${encodeURIComponent(cardId)}?action=publish`,
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({}),
 }
 );
 const data = await res.json();

 if (!res.ok) {
 toast.error(data.error || 'فشل النشر على تليجرام', { id: toastId });
 return;
 }

 toast.success(data.message || 'تم النشر على تليجرام بنجاح', { id: toastId });
 // If preview is open, update it
 if (previewCard?.id === cardId && previewCard) {
 setPreviewCard({ ...previewCard, status: 'published' });
 }
 // Refresh list
 await fetchCards('refresh');
 } catch (err) {
 console.error('[admin/educational-cards] publish error:', err);
 toast.error('خطأ في النشر على تليجرام', { id: toastId });
 } finally {
 setPublishingIds((prev) => {
 const next = new Set(prev);
 next.delete(cardId);
 return next;
 });
 }
 };

 // --------------------------------------------------------------------------
 // Delete a card
 // --------------------------------------------------------------------------
 const handleDelete = async (cardId: string) => {
 if (!window.confirm('هل أنت متأكد من حذف هذا الكارت؟ لا يمكن التراجع عن هذا الإجراء.')) {
 return;
