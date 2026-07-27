import { Typography, theme } from 'antd';
import type { CSSProperties } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const { Text } = Typography;

const announcementSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    p: [
      ...(defaultSchema.attributes?.p || []),
      ['align', 'left', 'center', 'right', 'justify'],
    ],
    img: [
      ...(defaultSchema.attributes?.img || []),
      ['width', /^\d{1,4}$/],
      ['height', /^\d{1,4}$/],
    ],
  },
};

interface MarkdownRendererProps {
  content?: string | null;
  compact?: boolean;
}

const isSafeUrl = (url?: string | null) => {
  if (!url) {
    return false;
  }

  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();

  return lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('mailto:')
    || (trimmed.startsWith('/') && !trimmed.startsWith('//'))
    || trimmed.startsWith('#');
};

const isSafeImageUrl = (url?: string | null) => {
  if (!url) {
    return false;
  }

  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();

  return lower.startsWith('http://')
    || lower.startsWith('https://')
    || (trimmed.startsWith('/') && !trimmed.startsWith('//'));
};

export default function MarkdownRenderer({ content, compact = false }: MarkdownRendererProps) {
  const { token } = theme.useToken();
  const markdown = (content || '').trim();

  const components: Components = {
    a: ({ href, children, ...props }) => {
      const safeHref = isSafeUrl(href) ? href : undefined;
      const isExternal = Boolean(safeHref && /^https?:\/\//i.test(safeHref));

      return (
        <a
          {...props}
          href={safeHref}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer noopener' : undefined}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, ...props }) => {
      const safeSrc = isSafeImageUrl(src) ? src : undefined;
      if (!safeSrc) {
        return null;
      }

      return (
        <img
          {...props}
          src={safeSrc}
          alt={alt || '公告图片'}
          loading="lazy"
        />
      );
    },
    code: ({ className, children, ...props }) => {
      const languageMatch = /language-([\w-]+)/.exec(className || '');
      const text = String(children).replace(/\n$/, '');
      const isBlock = Boolean(languageMatch) || text.includes('\n');

      if (!isBlock) {
        return <Text code>{children}</Text>;
      }

      return (
        <pre className="announcement-markdown-code">
          {languageMatch && (
            <div className="announcement-markdown-code-lang">
              {languageMatch[1]}
            </div>
          )}
          <code {...props} className={className}>{text}</code>
        </pre>
      );
    },
    table: ({ children, ...props }) => (
      <div className="announcement-markdown-table-wrap">
        <table {...props}>{children}</table>
      </div>
    ),
  };

  return (
    <div
      className={`announcement-markdown ${compact ? 'announcement-markdown-compact' : ''}`}
      style={
        {
          '--md-color-text': token.colorText,
          '--md-color-text-heading': token.colorTextHeading,
          '--md-color-text-secondary': token.colorTextSecondary,
          '--md-color-text-tertiary': token.colorTextTertiary,
          '--md-color-primary': token.colorPrimary,
          '--md-color-border-secondary': token.colorBorderSecondary,
          '--md-color-fill-tertiary': token.colorFillTertiary,
          '--md-color-fill-quaternary': token.colorFillQuaternary,
        } as CSSProperties
      }
    >
      {markdown ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, announcementSanitizeSchema]]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      ) : (
        <Text type="secondary">暂无内容</Text>
      )}
    </div>
  );
}
