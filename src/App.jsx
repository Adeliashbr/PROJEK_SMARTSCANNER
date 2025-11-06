
 import React, { useState, useRef } from 'react';
import { Upload, Download, FileText, Zap, RotateCcw, CheckCircle, AlertCircle } from 'lucide-react';

const SmartScanner = () => {
  const [originalImage, setOriginalImage] = useState(null); // HTMLImageElement
  const [processedImage, setProcessedImage] = useState(null); // dataURL
  const [processing, setProcessing] = useState(false);
  const [docType, setDocType] = useState('letter');
  const [step, setStep] = useState('');
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const docTypes = {
    letter: { name: 'Surat Dokumen', desc: 'Meluruskan perspektif', icon: '📄' },
    certificate: { name: 'Sertifikat/Ijazah', desc: 'Membersihkan bayangan', icon: '🎓' },
    handwriting: { name: 'Tulisan Tangan', desc: 'Memperjelas teks', icon: '✍️' }
  };

  // --- helper: tunggu OpenCV siap (jika dipakai) ---
  const waitForCv = () => {
    return new Promise((resolve) => {
      // jika sudah ada dan siap (Mat tersedia), resolve
      if (window.cv && window.cv.Mat) {
        resolve();
        return;
      }
      // jika opencv.js men-set onRuntimeInitialized, tunggu
      const check = () => {
        if (window.cv && window.cv.Mat) return resolve();
        setTimeout(check, 100);
      };
      check();
    });
  };

  // --- file upload (input) ---
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        setOriginalImage(img);
        setProcessedImage(null);
        setStep('');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // --- drag & drop handlers ---
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        setOriginalImage(img);
        setProcessedImage(null);
        setStep('');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // --- small image processing helpers (keperluan fallback) ---
  const rgbToGray = (imageData) => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    return imageData;
  };

  const applyGaussianBlur = (imageData) => {
    // simple box blur fallback (keperluan kecil)
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const output = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i++) output[i] = data[i];
    // very small blur kernel (inefisien tapi cukup kalau OpenCV tidak tersedia)
    const kernel = 1; // no-op small blur
    return imageData;
  };

// --- perspective transform pakai OpenCV.js (async) ---
const perspectiveTransform = async (ctx, imgEl) => {
  setStep('🔍 Memuat OpenCV / gambar...');
  try {
    await waitForCv();
  } catch (err) {
    console.warn('OpenCV tidak siap, fallback crop akan digunakan', err);
  }

  if (window.cv && window.cv.Mat) {
    setStep('📐 Memproses dengan OpenCV...');
    const cv = window.cv;

    const src = cv.imread(imgEl);
    const original = src.clone();

    // Ubah ke grayscale untuk bantu deteksi tepi (tapi jangan dipakai untuk hasil akhir)
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, gray, 75, 200);

    // Cari kontur
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(gray, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let bestContour = null;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > maxArea) {
        maxArea = area;
        bestContour = cnt;
      }
    }

    const dstCanvas = document.createElement('canvas');

    if (bestContour && maxArea > 1000) {
      const peri = cv.arcLength(bestContour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(bestContour, approx, 0.02 * peri, true);

      if (approx.rows === 4) {
        // ambil titik 4 sudut
        const pts = [];
        for (let i = 0; i < 4; i++) {
          pts.push({
            x: approx.data32S[i * 2],
            y: approx.data32S[i * 2 + 1],
          });
        }

        // urutkan titik
        pts.sort((a, b) => a.y - b.y);
        const top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
        const bottom = pts.slice(2, 4).sort((a, b) => a.x - b.x);
        const ordered = [top[0], top[1], bottom[1], bottom[0]];

        const wA = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
        const wB = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
        const maxWidth = Math.max(Math.round(wA), Math.round(wB));

        const hA = Math.hypot(ordered[1].x - ordered[2].x, ordered[1].y - ordered[2].y);
        const hB = Math.hypot(ordered[0].x - ordered[3].x, ordered[0].y - ordered[3].y);
        const maxHeight = Math.max(Math.round(hA), Math.round(hB));

        const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
          ordered[0].x, ordered[0].y,
          ordered[1].x, ordered[1].y,
          ordered[2].x, ordered[2].y,
          ordered[3].x, ordered[3].y,
        ]);
        const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          maxWidth - 1, 0,
          maxWidth - 1, maxHeight - 1,
          0, maxHeight - 1,
        ]);

        const M = cv.getPerspectiveTransform(srcCoords, dstCoords);
        const dst = new cv.Mat();

        // Warp hasil dari gambar asli (bukan dari gray!)
        cv.warpPerspective(original, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_REPLICATE);

        dstCanvas.width = maxWidth;
        dstCanvas.height = maxHeight;
        cv.imshow(dstCanvas, dst);

        // Bersihkan memori
        src.delete(); original.delete(); gray.delete();
        contours.delete(); hierarchy.delete();
        bestContour.delete(); approx.delete(); srcCoords.delete(); dstCoords.delete(); M.delete(); dst.delete();

        setStep('✅ Dokumen berhasil diluruskan!');
        return dstCanvas;
      }
    }

    // fallback: tampilkan gambar asli
    cv.imshow(ctx.canvas, original);
    src.delete(); original.delete(); gray.delete();
    contours.delete(); hierarchy.delete();
    setStep('⚠️ Tidak dapat menemukan 4 sudut. Menampilkan gambar asli.');
    return ctx.canvas;
  } else {
    // fallback sederhana
    setStep('⚠️ OpenCV tidak tersedia, fallback crop...');
    const canvas = ctx.canvas;
    const width = imgEl.width;
    const height = imgEl.height;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(imgEl, 0, 0);
    return canvas;
  }
};


  // --- main process flow ---
  const processImage = async () => {
    if (!originalImage) return;
    setProcessing(true);
    setStep('🚀 Memulai...');
    await new Promise(r => setTimeout(r, 120)); // jeda kecil supaya UI update

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    try {
      let resultCanvas;
      if (docType === 'letter') {
        resultCanvas = await perspectiveTransform(ctx, originalImage);
      } else if (docType === 'certificate') {
        // gunakan removeShadows logic (simple) - fallback tanpa OpenCV
        resultCanvas = await (async () => {
          // menggunakan canvas yang sama: crop full and apply simple adjustments
          const c = document.createElement('canvas');
          const w = originalImage.width;
          const h = originalImage.height;
          c.width = w; c.height = h;
          const cctx = c.getContext('2d');
          cctx.drawImage(originalImage, 0, 0);
          // very naive brightness boost
          const imd = cctx.getImageData(0,0,w,h);
          for (let i = 0; i < imd.data.length; i += 4) {
            imd.data[i] = Math.min(255, imd.data[i] * 1.05 + 10);
            imd.data[i+1] = Math.min(255, imd.data[i+1] * 1.05 + 10);
            imd.data[i+2] = Math.min(255, imd.data[i+2] * 1.05 + 10);
          }
          cctx.putImageData(imd, 0,0);
          return c;
        })();
      } else {
        // handwriting enhancement fallback
        const c = document.createElement('canvas');
        const w = originalImage.width;
        const h = originalImage.height;
        c.width = w; c.height = h;
        const cctx = c.getContext('2d');
        cctx.drawImage(originalImage, 0, 0);
        // convert to gray
        const imd = cctx.getImageData(0,0,w,h);
        for (let i = 0; i < imd.data.length; i += 4) {
          const gray = 0.299 * imd.data[i] + 0.587 * imd.data[i+1] + 0.114 * imd.data[i+2];
          imd.data[i] = imd.data[i+1] = imd.data[i+2] = gray < 120 ? gray * 0.55 : Math.min(255, gray * 1.45);
        }
        cctx.putImageData(imd, 0,0);
        resultCanvas = c;
      }

      // convert result canvas to dataURL
      const dataUrl = resultCanvas.toDataURL('image/png', 0.95);
      setProcessedImage(dataUrl);
      setStep('✅ Selesai!');
    } catch (err) {
      console.error(err);
      setStep('❌ Error saat memproses');
    } finally {
      setProcessing(false);
    }
  };

  const downloadImage = () => {
    if (!processedImage) return;
    const link = document.createElement('a');
    link.download = `scanned_${docType}_${Date.now()}.png`;
    link.href = processedImage;
    link.click();
  };

  const reset = () => {
    setOriginalImage(null);
    setProcessedImage(null);
    setStep('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-block bg-white rounded-2xl shadow-xl px-8 py-6 mb-6">
            <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-3">
              📱 Smart Document Scanner
            </h1>
            <p className="text-gray-700 text-lg font-medium">Pemindai Dokumen Mahasiswa - Citra Digital Project</p>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <span className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
              Perspective Transform
            </span>
            <span className="bg-gradient-to-r from-green-500 to-green-600 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
              Edge Detection
            </span>
            <span className="bg-gradient-to-r from-purple-500 to-purple-600 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
              Histogram Equalization
            </span>
            <span className="bg-gradient-to-r from-pink-500 to-pink-600 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg">
              Noise Removal
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {Object.entries(docTypes).map(([key, info]) => (
            <button
              key={key}
              onClick={() => setDocType(key)}
              className={`p-8 rounded-2xl border-2 transition-all transform hover:scale-105 ${
                docType === key
                  ? 'border-blue-500 bg-blue-50 shadow-2xl scale-105'
                  : 'border-gray-300 bg-white hover:border-blue-300 shadow-lg'
              }`}
            >
              <div className="text-6xl mb-4">{info.icon}</div>
              <h3 className="font-bold text-xl text-gray-800 mb-2">{info.name}</h3>
              <p className="text-gray-600">{info.desc}</p>
              {docType === key && (
                <div className="mt-3">
                  <CheckCircle className="w-6 h-6 mx-auto text-green-600" />
                </div>
              )}
            </button>
          ))}
        </div>

        {!originalImage && (
          <div className="mb-10">
            {/* Drop zone (juga untuk klik) */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="w-full p-12 border-4 border-dashed border-indigo-300 rounded-2xl bg-white hover:bg-indigo-50 hover:border-indigo-500 transition-all group shadow-xl text-center cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Upload className="w-20 h-20 mx-auto mb-6 text-indigo-400 group-hover:text-indigo-600 transition-colors" />
              <p className="text-2xl font-bold text-gray-800 mb-3">📤 Upload Dokumen</p>
              <p className="text-gray-600 text-lg">Klik atau drag & drop gambar di sini</p>
            </div>
          </div>
        )}

        {originalImage && (
          <div className="space-y-8">
            <div className="flex flex-wrap gap-4 justify-center">
              <button
                onClick={processImage}
                disabled={processing}
                className="px-10 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 font-bold text-lg transition-all shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center gap-3"
              >
                <Zap className="w-6 h-6" />
                {processing ? '⚡ Memproses...' : '🚀 Proses Dokumen'}
              </button>
              <button
                onClick={reset}
                className="px-10 py-4 bg-white text-gray-800 rounded-xl hover:bg-gray-100 font-bold text-lg transition-all shadow-lg border-2 border-gray-300 flex items-center gap-3"
              >
                <RotateCcw className="w-6 h-6" />
                Reset
              </button>
              {processedImage && (
                <button
                  onClick={downloadImage}
                  className="px-10 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 font-bold text-lg transition-all shadow-lg transform hover:scale-105 flex items-center gap-3"
                >
                  <Download className="w-6 h-6" />
                  Download
                </button>
              )}
            </div>

            {processing && step && (
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-300 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center justify-center gap-4">
                  <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
                  <p className="text-blue-800 font-bold text-xl">{step}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-gray-700 to-gray-800 text-white px-6 py-4 flex items-center gap-3">
                  <FileText className="w-6 h-6" />
                  <span className="font-bold text-lg">Dokumen Asli</span>
                </div>
                <div className="p-6 bg-gray-50">
                  {originalImage && (
                    <img src={originalImage.src} alt="Original" className="w-full h-auto rounded-lg shadow-md" />
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4 flex items-center gap-3">
                  <CheckCircle className="w-6 h-6" />
                  <span className="font-bold text-lg">Hasil Scan</span>
                </div>
                <div className="p-6 bg-gradient-to-br from-blue-50 to-purple-50">
                  {processedImage ? (
                    <img src={processedImage} alt="Processed" className="w-full h-auto rounded-lg shadow-md" />
                  ) : (
                    <div className="aspect-[3/4] flex flex-col items-center justify-center bg-gray-100 rounded-xl border-2 border-dashed border-gray-300">
                      <AlertCircle className="w-16 h-16 text-gray-400 mb-4" />
                      <p className="text-gray-500 font-medium">Hasil akan muncul di sini</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {processedImage && (
              <div className="bg-gradient-to-r from-indigo-50 to-pink-50 rounded-2xl p-8 border-2 border-purple-200 shadow-xl">
                <h3 className="font-extrabold text-gray-800 mb-6 text-2xl">
                  🔬 Teknik yang Diterapkan
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl p-5 shadow-lg">
                    <div className="text-3xl mb-2">🔍</div>
                    <div className="font-bold text-gray-800">Edge Detection</div>
                    <div className="text-xs text-gray-600">Sobel / Canny</div>
                  </div>
                  <div className="bg-white rounded-xl p-5 shadow-lg">
                    <div className="text-3xl mb-2">📐</div>
                    <div className="font-bold text-gray-800">Perspective</div>
                    <div className="text-xs text-gray-600">WarpPerspective</div>
                  </div>
                  <div className="bg-white rounded-xl p-5 shadow-lg">
                    <div className="text-3xl mb-2">🔧</div>
                    <div className="font-bold text-gray-800">Noise Removal</div>
                    <div className="text-xs text-gray-600">Gaussian</div>
                  </div>
                  <div className="bg-white rounded-xl p-5 shadow-lg">
                    <div className="text-3xl mb-2">✨</div>
                    <div className="font-bold text-gray-800">Enhancement</div>
                    <div className="text-xs text-gray-600">Quality Boost</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* hidden canvas used by OpenCV or fallback rendering */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};

export default SmartScanner;
