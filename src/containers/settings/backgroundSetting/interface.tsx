import { RouteComponentProps } from "react-router-dom";

export interface SettingInfoProps extends RouteComponentProps<any> {
  t: (title: string) => string;
  handleReaderBackgroundImage?: (readerBackgroundImage: string) => void;
}

export interface BackgroundImage {
  id: string;
  name: string;
  extension: string;
  textColor?: string;
  backgroundColor?: string;
}

/** A background the server offers; paths are inside assets/backgrounds */
export interface FeaturedBackground {
  id: string;
  path: string;
  thumbnailPath: string;
}

export interface SettingInfoState {
  images: BackgroundImage[];
  /** loaded dataUrls keyed by image id */
  loadedUrls: Record<string, string>;
  previewImage: BackgroundImage | null;
  /** featured backgrounds on the server */
  featured: FeaturedBackground[];
  /** thumbnail object URLs keyed by featured id */
  featuredUrls: Record<string, string>;
  /** featured background currently in preview, and its full-size URL */
  previewFeatured: FeaturedBackground | null;
  previewFeaturedUrl: string;
  appBackgroundId: string;
  readerBackgroundId: string;
  isLoading: boolean;
  /** featured ids whose thumbnail has entered the viewport */
  visibleFeatured: Set<string>;
  /** id of the featured background being downloaded */
  downloadingId: string;
  downloadProgress: number;
}
