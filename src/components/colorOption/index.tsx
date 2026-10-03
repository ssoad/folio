import { connect } from "react-redux";
import { handleHighlight, handleSelection } from "../../store/actions";
import { stateType } from "../../store";
import { withTranslation } from "react-i18next";
import ColorOption from "./component";
const mapStateToProps = (state: stateType) => {
  return {
    highlight: state.reader.highlight,
  };
};
const actionCreator = {
  handleHighlight,
  handleSelection,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(ColorOption as any) as any);
