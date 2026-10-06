import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import Onboarding from "./component";
import { handleSetting, handleSettingMode } from "../../store/actions";

export { shouldShowOnboarding } from "./component";

const actionCreator = { handleSetting, handleSettingMode };
export default connect(
  null,
  actionCreator
)(withTranslation()(Onboarding as any) as any);
