import type { CSSProperties } from 'react';

// 玻璃态卡片通用常量（暗黑风格 + 紫色 #7C3AED 强调）
const glassCardBackground = 'color-mix(in srgb, var(--ant-color-bg-container) 85%, transparent)';
const glassCardBackdropFilter = 'blur(16px) saturate(160%)';
const glassCardBaseBorder = '1px solid rgba(124, 58, 237, 0.2)';
const glassCardBaseShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';

const glassCardHoverBorderColor = 'rgba(124, 58, 237, 0.45)';
const glassCardHoverShadow = '0 12px 40px rgba(124, 58, 237, 0.2)';

// 新建项目卡片：紫色虚线边框
const newProjectCardBaseBorder = '2px dashed rgba(124, 58, 237, 0.4)';
const newProjectCardHoverBorderColor = 'rgba(124, 58, 237, 0.6)';

// BookshelfPage 样式（书架/书本卡片）
export const bookshelfCardStyles = {
  container: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px 18px',
    padding: '8px 0 16px',
    alignItems: 'stretch',
  } as CSSProperties,

  projectCard: {
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    background: glassCardBackground,
    backdropFilter: glassCardBackdropFilter,
    WebkitBackdropFilter: glassCardBackdropFilter,
    boxShadow: glassCardBaseShadow,
    transition: 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), border-color 0.3s ease',
    border: glassCardBaseBorder,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  } as CSSProperties,

  newProjectCard: {
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    background: glassCardBackground,
    backdropFilter: glassCardBackdropFilter,
    WebkitBackdropFilter: glassCardBackdropFilter,
    boxShadow: glassCardBaseShadow,
    border: newProjectCardBaseBorder,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease, background-color 0.3s ease',
    position: 'relative',
  } as CSSProperties,
};

export const bookshelfCardHoverHandlers = {
  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.dataset.cardStyle !== 'bookshelf-book') {
      return;
    }

    if (target.dataset.bookKind === 'new') {
      target.style.transform = 'translateY(-4px)';
      target.style.boxShadow = glassCardHoverShadow;
      target.style.borderColor = newProjectCardHoverBorderColor;
      return;
    }

    target.style.transform = 'translateY(-4px)';
    target.style.boxShadow = glassCardHoverShadow;
    target.style.borderColor = glassCardHoverBorderColor;
  },
  onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.dataset.cardStyle !== 'bookshelf-book') {
      return;
    }

    const isNewBook = target.dataset.bookKind === 'new';
    target.style.transform = 'translateY(0)';
    target.style.boxShadow = glassCardBaseShadow;
    target.style.borderColor = isNewBook ? newProjectCardBaseBorder : glassCardBaseBorder;
  },
};

// PromptTemplates 页面卡片样式
export const promptTemplateCardStyles = {
  templateCard: {
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    border: glassCardBaseBorder,
    background: glassCardBackground,
    backdropFilter: glassCardBackdropFilter,
    WebkitBackdropFilter: glassCardBackdropFilter,
    boxShadow: glassCardBaseShadow,
    transition: 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.28s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.28s ease',
  } as CSSProperties,
};

export const promptTemplateCardHoverHandlers = {
  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.style.transform = 'translateY(-4px)';
    target.style.boxShadow = glassCardHoverShadow;
    target.style.borderColor = glassCardHoverBorderColor;
  },
  onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.style.transform = 'translateY(0)';
    target.style.boxShadow = glassCardBaseShadow;
    target.style.borderColor = glassCardBaseBorder;
  },
};

export const promptTemplateGridConfig = {
  xs: 24,
  sm: 12,
  lg: 8,
  xl: 6,
};

// WorldSetting 页面卡片样式
export const worldSettingCardStyles = {
  sectionCard: {
    borderRadius: 16,
    border: glassCardBaseBorder,
    backdropFilter: glassCardBackdropFilter,
    WebkitBackdropFilter: glassCardBackdropFilter,
    boxShadow: glassCardBaseShadow,
    background: glassCardBackground,
    transition: 'box-shadow 0.24s ease, border-color 0.24s ease',
  } as CSSProperties,
};

// Characters 页面（CharacterCard + 网格）样式
export const characterCardStyles = {
  characterCard: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 16,
    border: glassCardBaseBorder,
    backdropFilter: glassCardBackdropFilter,
    WebkitBackdropFilter: glassCardBackdropFilter,
    background: glassCardBackground,
    boxShadow: glassCardBaseShadow,
  } as CSSProperties,

  organizationCard: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 16,
    border: glassCardBaseBorder,
    backdropFilter: glassCardBackdropFilter,
    WebkitBackdropFilter: glassCardBackdropFilter,
    background: glassCardBackground,
    boxShadow: glassCardBaseShadow,
  } as CSSProperties,

  nameEllipsis: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,

  descriptionBlock: {
    marginTop: 12,
    maxHeight: 200,
    overflow: 'hidden',
  } as CSSProperties,
};

export const charactersPageGridConfig = {
  gutter: 0,
  xs: 24,
  sm: 12,
  md: 12,
  lg: 6,
  xl: 6,
  xxl: 5,
};

// 页面通用文本样式（仅用于信息展示，不与卡片结构耦合）
export const commonTextStyles = {
  label: {
    fontSize: 12,
    color: 'color-mix(in srgb, var(--ant-color-text) 55%, transparent)',
  } as CSSProperties,

  value: {
    fontSize: 14,
    color: 'var(--ant-color-text)',
  } as CSSProperties,

  description: {
    fontSize: 12,
    color: 'color-mix(in srgb, var(--ant-color-text) 55%, transparent)',
    lineHeight: 1.6,
  } as CSSProperties,
};
