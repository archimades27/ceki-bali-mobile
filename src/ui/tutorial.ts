import { createObsidianDialog } from './modals.ts';

export class TutorialModal {
  private dialog: HTMLDialogElement;
  private bodyEl: HTMLElement;

  constructor() {
    const { dialog, body } = createObsidianDialog('tutorial-modal', 'Panduan Ceki Bali', 'any');
    this.dialog = dialog;
    this.bodyEl = body;
    this.renderContent();
  }

  private renderContent(): void {
    this.bodyEl.innerHTML = `
      <div class="guide-section">
        <h3>Tujuan Permainan</h3>
        <p>Kumpulkan <strong>12 kartu (4 susunan × 3 kartu)</strong> dengan minimal <strong>2 Soca</strong> untuk menang (<em>Ngenen / Ceki</em>).</p>
      </div>

      <div class="guide-section">
        <h3>3 Jenis Susunan (Meld)</h3>
        <ul>
          <li><strong>Soca</strong>: 3 kartu sama persis (contoh: 3× Cepe).</li>
          <li><strong>Lawang</strong>: 2 kartu sama persis + 1 kartu berbeda dalam 1 keluarga.</li>
          <li><strong>Serigat</strong>: 3 kartu berbeda dalam 1 keluarga yang sama.</li>
        </ul>
      </div>

      <div class="guide-section">
        <h3>Keluarga Penting (120 Kartu)</h3>
        <ul>
          <li><strong>Keluarga 4</strong>: Cepe, Lojor, Likas</li>
          <li><strong>Keluarga 7</strong>: Gunung, Jarum, Jebung 3</li>
          <li><strong>Keluarga 9</strong>: Cine, Kinci, Kobar</li>
        </ul>
      </div>

      <div class="guide-section">
        <h3>Mecari, Mejaga &amp; Ngandang</h3>
        <ul>
          <li><strong>🔍 MECARI</strong> (1 Soca di 11 kartu): Menunggu kartu yang sama persis untuk Soca ke-2.</li>
          <li><strong>🔥 MEJAGA</strong> (≥ 2 Soca di 11 kartu): Menang dengan kartu apa saja dalam satu keluarga (<em>Kupak Nyari</em>).</li>
          <li><strong>Ngandang</strong>: Menang saat membuka kartu kemenangan sendiri dari Tumpukan.</li>
          <li><em>Catatan:</em> Kemenangan <strong>tidak boleh</strong> dari Ngejuk atau buangan tangan; harus dari kupakan Tumpukan.</li>
        </ul>
      </div>

      <div class="guide-section">
        <h3>Aturan Putaran &amp; Ngejuk (Turnamen)</h3>
        <ul>
          <li><strong>Arah Putaran (↺)</strong>: Permainan berjalan <strong>melawan jarum jam</strong> dengan posisi buangan Anda berada di sisi <strong>kanan</strong>.</li>
          <li><strong>Ngejuk Terbuka (Jukjukan)</strong>: Kartu yang diambil melalui <em>Ngejuk</em> wajib tetap terbuka dan terlihat oleh semua pemain.</li>
          <li><strong>Larangan Buang Jukjukan</strong>: Kartu hasil Ngejuk <strong>tidak boleh dibuang</strong>, kecuali jika membuang kartu tersebut langsung membuat Anda <strong>Nyari</strong> (<em>Mecari</em> / <em>Mejaga</em>).</li>
          <li><strong>Larangan Ngutang-Ngejuk</strong>: Tidak diperbolehkan mengejuk kartu yang sama persis dengan kartu yang sudah pernah Anda buang pada babak ini.</li>
        </ul>
      </div>

      <div class="guide-section">
        <h3>Kontrol Portrait Satu Tangan</h3>
        <ul>
          <li><strong>Geser Kartu (Drag)</strong>: Sentuh &amp; geser kartu di tangan untuk mengatur urutan manual.</li>
          <li><strong>Ketuk Kartu</strong>: Ketuk cepat saat giliran buang untuk langsung memilih / membuang kartu.</li>
          <li><strong>Susun Otomatis (↻ Susun)</strong>: Mengelompokkan <em>Soca → Lawang → Serigat</em> lalu sisa per keluarga.</li>
          <li><strong>Ketuk Buangan Lawan</strong>: Lihat seluruh kartu buangan pemain tersebut.</li>
        </ul>
      </div>
    `;
  }

  open(): void {
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
  }
}
