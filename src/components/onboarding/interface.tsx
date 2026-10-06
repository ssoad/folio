export interface OnboardingProps {
  handleSetting: (isSettingOpen: boolean) => void;
  handleSettingMode: (settingMode: string) => void;
  onDone: () => void;
  t: (title: string) => string;
}

export interface OnboardingState {
  index: number;
  // Finger's horizontal travel while swiping, in px
  dragX: number;
  isDragging: boolean;
  isLeaving: boolean;
}
