import React, { useState, useRef, useCallback, useEffect } from 'react';
import Icon from '../../../components/AppIcon';

const PhotoCapturePanel = ({ onPhotoCapture, capturedPhoto, onRemove }) => {
  const [mode, setMode] = useState('upload'); // 'upload' | 'webcam'
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState('');
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const stopWebcam = useCallback(() => {
    stream?.getTracks()?.forEach(track => track?.stop());
    setStream(null);
    setWebcamActive(false);
  }, [stream]);

  useEffect(() => {
    return () => { stream?.getTracks()?.forEach(track => track?.stop()); };
  }, [stream]);

  const startWebcam = async () => {
    setWebcamError('');
    try {
      const mediaStream = await navigator?.mediaDevices?.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      setStream(mediaStream);
      setWebcamActive(true);
      if (videoRef?.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      setWebcamError('Camera access denied. Please use file upload instead.');
      setMode('upload');
    }
  };

  const capturePhoto = () => {
    if (!videoRef?.current || !canvasRef?.current) return;
    const canvas = canvasRef?.current;
    const video = videoRef?.current;
    canvas.width = video?.videoWidth;
    canvas.height = video?.videoHeight;
    const ctx = canvas?.getContext('2d');
    ctx?.drawImage(video, 0, 0);
    const dataUrl = canvas?.toDataURL('image/jpeg', 0.85);
    onPhotoCapture?.({ preview: dataUrl, name: 'photo_capture.jpg', type: 'image/jpeg', size: 0 });
    stopWebcam();
  };

  const handleFileUpload = (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (!file?.type?.startsWith('image/')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      onPhotoCapture?.({ preview: ev?.target?.result, name: file?.name, type: file?.type, size: file?.size });
    };
    reader?.readAsDataURL(file);
  };

  const handleModeSwitch = (newMode) => {
    if (webcamActive) stopWebcam();
    setMode(newMode);
    if (newMode === 'webcam') startWebcam();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">Passport Photo</label>
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
          <button
            onClick={() => handleModeSwitch('upload')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === 'upload' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name="Upload" size={12} color="currentColor" />
            Upload
          </button>
          <button
            onClick={() => handleModeSwitch('webcam')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === 'webcam' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name="Camera" size={12} color="currentColor" />
            Webcam
          </button>
        </div>
      </div>

      {capturedPhoto ? (
        <div className="relative border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3">
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 rounded-xl overflow-hidden border border-border flex-shrink-0 bg-muted">
              <img src={capturedPhoto?.preview} alt="Captured passport photo" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Photo captured</p>
              <p className="text-xs text-muted-foreground mt-0.5">{capturedPhoto?.name}</p>
              <div className="flex items-center gap-1 mt-1">
                <Icon name="CheckCircle" size={12} color="#10b981" />
                <span className="text-xs text-emerald-500">Ready for submission</span>
              </div>
            </div>
            <button
              onClick={onRemove}
              className="p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
            >
              <Icon name="X" size={14} color="currentColor" />
            </button>
          </div>
        </div>
      ) : mode === 'webcam' ? (
        <div className="space-y-2">
          {webcamError ? (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <Icon name="AlertCircle" size={14} color="#ef4444" />
              <p className="text-xs text-red-500">{webcamError}</p>
            </div>
          ) : (
            <div className="relative rounded-xl overflow-hidden bg-black border border-border">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-48 object-cover"
                onLoadedMetadata={() => {}}
              />
              {/* Face guide overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-28 h-36 border-2 border-white/60 rounded-full opacity-60" />
              </div>
              <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                <button
                  onClick={capturePhoto}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-gray-900 rounded-full text-sm font-semibold shadow-lg hover:bg-gray-100 transition-colors"
                >
                  <Icon name="Camera" size={14} color="currentColor" />
                  Capture
                </button>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      ) : (
        <div
          onClick={() => fileInputRef?.current?.click()}
          className="border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/50 rounded-xl p-6 cursor-pointer transition-all text-center"
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
              <Icon name="UserSquare" size={20} color="var(--color-muted-foreground)" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Upload passport photo</p>
              <p className="text-xs text-muted-foreground mt-0.5">JPG or PNG, clear face visible</p>
            </div>
          </div>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
    </div>
  );
};

export default PhotoCapturePanel;
