import { ProjectType, LanguageInfo } from '../core/tech-mapper.js';

/**
 * shields.io badge styles.
 */
export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge' | 'plastic' | 'social' | 'none';

/**
 * Options for generating a badge.
 */
export interface BadgeOptions {
  /**
   * The style of the badge. Defaults to 'for-the-badge'.
   */
  style?: BadgeStyle;
  /**
   * Hex color for the badge background (without #).
   */
  color?: string;
  /**
   * Logo to display on the badge (simple-icons slug).
   */
  logo?: string;
  /**
   * Color for the logo. Defaults to 'white'.
   */
  logoColor?: string;
  /**
   * Label text for the badge.
   */
  label?: string;
  /**
   * Link to open when the badge is clicked.
   */
  link?: string;
}

/**
 * BadgeGenerator utility to create shields.io Markdown badges.
 */
export class BadgeGenerator {
  private static readonly DEFAULT_STYLE: BadgeStyle = 'for-the-badge';
  private static readonly DEFAULT_LOGO_COLOR: string = 'white';

  /**
   * Generates a shields.io badge URL.
   */
  public static generateUrl(options: BadgeOptions): string {
    const {
      label = 'badge',
      color = 'blue',
      style = this.DEFAULT_STYLE,
      logo,
      logoColor = this.DEFAULT_LOGO_COLOR,
    } = options;

    if (style === 'none') {
      return '';
    }

    const encodedLabel = encodeURIComponent(label.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_'));
    const encodedColor = encodeURIComponent(color);
    
    let url = `https://img.shields.io/badge/${encodedLabel}-${encodedColor}?style=${style}`;

    if (logo) {
      url += `&logo=${encodeURIComponent(logo)}`;
      url += `&logoColor=${encodeURIComponent(logoColor)}`;
    }

    return url;
  }

  /**
   * Generates a Markdown badge string: `![label](url)` or `[![label](url)](link)`.
   */
  public static generateMarkdown(options: BadgeOptions): string {
    const {
      style = this.DEFAULT_STYLE,
    } = options;

    if (style === 'none') {
      return '';
    }

    const url = this.generateUrl(options);
    const label = options.label || 'badge';
    const markdown = `![${label}](${url})`;

    if (options.link) {
      return `[${markdown}](${options.link})`;
    }

    return markdown;
  }

  /**
   * Generates a badge for a project type detected by TechMapper.
   */
  public static fromProjectType(project: ProjectType, style?: BadgeStyle): string {
    return this.generateMarkdown({
      label: project.label,
      color: project.color,
      logo: project.badgeSlug,
      style: style || this.DEFAULT_STYLE,
    });
  }

  /**
   * Generates a badge for a language detected by TechMapper.
   */
  public static fromLanguage(language: LanguageInfo, style?: BadgeStyle): string {
    return this.generateMarkdown({
      label: language.name,
      color: language.color,
      logo: language.badgeSlug,
      style: style || this.DEFAULT_STYLE,
    });
  }

  /**
   * Generates a collection of badges for a list of project types.
   */
  public static fromProjectTypes(projects: ProjectType[], style?: BadgeStyle): string {
    return projects.map(p => this.fromProjectType(p, style)).join(' ');
  }

  /**
   * Generates a collection of badges for a list of languages.
   */
  public static fromLanguages(languages: LanguageInfo[], style?: BadgeStyle): string {
    return languages.map(l => this.fromLanguage(l, style)).join(' ');
  }
}
