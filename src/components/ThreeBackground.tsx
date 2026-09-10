import React from 'react';

export default function ThreeBackground() {
  return (
    <div className="absolute inset-0 -z-10 pointer-events-none bg-slate-950 overflow-hidden">
      {/* Animated Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950" />
      
      {/* Floating Glowing Orbs mimicking 3D spheres */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-600/25 rounded-full filter blur-[120px] animate-pulse transition-all duration-1000" style={{ animationDuration: '8s' }} />
      <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-pink-600/20 rounded-full filter blur-[140px] animate-pulse transition-all duration-1000" style={{ animationDuration: '10s' }} />
      <div className="absolute top-1/2 right-1/3 w-[400px] h-[400px] bg-purple-600/20 rounded-full filter blur-[100px] animate-pulse transition-all duration-1000" style={{ animationDuration: '6s' }} />

      {/* Subtle grid pattern overlay for depth */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/80 backdrop-blur-[1px]" />
    </div>
  );
}

