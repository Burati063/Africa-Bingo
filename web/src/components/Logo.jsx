import React from 'react';

export default function Logo({ size = 40, className = '' }) {
  return (
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt="Africa Bingo"
      className={`brand-logo ${className}`}
      draggable={false}
    />
  );
}
