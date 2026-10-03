import BookModel from "../../../models/Book";
export interface AnnotationDialogProps {
  isAnnotationOpen: boolean;
  isSettingLocked: boolean;
  isDockedRight: boolean;
  handleAnnotationDialog: (isAnnotationOpen: boolean) => void;
  t: (title: string) => string;
  htmlBook: any;
  currentBook: BookModel;
}

export interface AnnotationDialogState {
  annotationStyle: string;
  annotationBrushColor: string;
  annotationBrushWidth: number;
  annotationHighlighterColor: string;
  annotationHighlighterWidth: number;
  annotationHighlighterOpacity: number;
  annotationShapeType: string;
  annotationShapeColor: string;
  annotationShapeWidth: number;
  annotationTextSize: number;
  annotationTextFont: string;
  annotationTextColor: string;
  fontOptions: { label: string; value: string }[];
}
