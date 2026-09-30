import { connect } from "react-redux";
import SelfHostedSetting from "./component";
import { withTranslation } from "react-i18next";
import { handleFetchAuthed, handleFetchPlugins } from "../../../store/actions";
import { stateType } from "../../../store";

const mapStateToProps = (_state: stateType) => {
  return {};
};
const actionCreator = {
  handleFetchPlugins,
  handleFetchAuthed,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(SelfHostedSetting as any) as any);
